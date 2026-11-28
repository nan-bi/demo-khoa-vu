"""Loopback-only STT. Audio stays in memory; no patient identifiers accepted."""
import io
import json
import os
import secrets
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import numpy as np

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from speech_config import profile, model_path, decode_options
from speech_postprocess import postprocess
PROFILE = profile()
MODEL_PATH = model_path(PROFILE)
KEY = os.environ['VU_VOICE_KEY']
LOCK = threading.Lock()
state = {'ready': False, 'model': 'PhoWhisper-' + PROFILE['name'] + ' · INT8 · CPU', 'repository': PROFILE['repository'], 'revision': PROFILE['revision'], 'error': ''}
model = None

def load_model():
    global model
    try:
        expected = PROFILE['repository'] + '\n' + PROFILE['revision'] + '\nint8\n'
        if (MODEL_PATH / 'READY').read_text(encoding='utf-8') != expected:
            raise ValueError('Model provenance mismatch')
        model = WhisperModel(str(MODEL_PATH), device='cpu', compute_type='int8',
                             cpu_threads=4, num_workers=1, local_files_only=True)
        state['ready'] = True
        print(state['model'] + ' ready (offline)', flush=True)
    except Exception:
        state['error'] = 'Chưa nạp được model. Chạy CAI-DAT-SPEECH.cmd rồi mở lại.'

def preprocess_audio(samples: np.ndarray) -> np.ndarray:
    """Stabilize noisy clinic recordings: DC/rumble filter, soft noise-floor gate, gain boost, limiter."""
    if not len(samples):
        return samples
    # 1. Attenuate low-frequency rumble and DC offset (fan motor / 50Hz AC hum < 85Hz)
    if len(samples) >= 188:
        rumble = np.convolve(samples, np.ones(188, dtype=np.float32) / 188.0, mode='same')
        samples = samples - rumble

    # 2. Soft RMS noise-floor gating (10ms frames = 160 samples at 16kHz)
    frame_len = 160
    n_frames = len(samples) // frame_len
    if n_frames >= 10:
        frames = samples[:n_frames * frame_len].reshape(n_frames, frame_len)
        rms = np.sqrt(np.mean(frames * frames, axis=1))
        noise_floor = float(np.percentile(rms, 15))
        speech_level = float(np.percentile(rms, 90))
        if 1e-4 < noise_floor < 0.08 and speech_level > noise_floor * 2.0:
            # Smoothly attenuate frames near the stationary noise floor without hard-clipping speech
            gain_mask = np.where(rms < noise_floor * 1.4, 0.30, 1.0).astype(np.float32)
            samples = samples.copy()
            samples[:n_frames * frame_len] = (frames * gain_mask[:, None]).reshape(-1)

    # 3. Dynamic gain boost for weak microphones (peak amplitude < 0.5)
    peak = float(np.max(np.abs(samples)))
    if 0.01 < peak < 0.5:
        samples = samples * min(0.75 / peak, 5.0)

    # 4. Soft limiter above 0.95 to avoid harsh clipping
    return np.clip(samples, -0.98, 0.98).astype(np.float32)


def transcribe(data, final=True):
    # Only PCM WAV created by our client: mono, 16 kHz, at most 30 seconds.
    with wave.open(io.BytesIO(data), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
            raise ValueError('Expected mono PCM16 16kHz')
        nframes = audio.getnframes()
        if not 0 < nframes <= 30 * 16000:
            raise ValueError('Audio duration out of range')
        raw_frames = audio.readframes(nframes)
    samples = preprocess_audio(np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32768.0)

    started = time.perf_counter()
    segments, _ = model.transcribe(samples, **decode_options(final))
    decoded = list(segments)
    raw_text = ' '.join(s.text.strip() for s in decoded).strip()

    # Post-process: normalize medical terminology and measurement units.
    # Corrections are logged for physician review; clinical text is never
    # silently altered without an explicit, deterministic, logged rule.
    post = postprocess(raw_text) if final else {'text': raw_text, 'corrections': [], 'flags': [], 'confidence': 0.95, 'accent_region': None}
    text = post['text']

    quality = assess_quality(decoded, text, post['flags'], post.get('confidence', 0.95))
    return {'text': text, 'seconds': round(time.perf_counter() - started, 3),
            'model': state['model'], 'revision': PROFILE['revision'], 'final': final,
            'needs_review': quality['needs_review'], 'quality': quality['level'],
            'quality_reason': quality['reason'],
            'confidence': quality['confidence'],
            'corrections': post['corrections'],
            'accent_region': post.get('accent_region'),
            'raw_text': raw_text if post['corrections'] else None}


def assess_quality(segments, text, postprocess_flags=None, postprocess_confidence=0.95):
    """Surface uncertainty; never rewrite clinical terms automatically.

    confidence: float returned in every response so the UI can show a badge.
    Rules (priority order):
      1. Empty / silent → needs_review, confidence 0.0
      2. Postprocess flags (accent or hallucination) → needs_review, use postprocess_confidence
      3. Whisper internals: high no_speech_prob, very negative avg_logprob, compression_ratio spike
      4. Mild no_speech_prob → caution
      5. All clear → ok
    """
    if not text.strip():
        return {'level': 'silent', 'needs_review': True, 'confidence': 0.0,
                'reason': 'Không phát hiện lời đọc rõ ràng hoặc đoạn chỉ có im lặng.'}
    if postprocess_flags:
        return {'level': 'caution', 'needs_review': True, 'confidence': postprocess_confidence,
                'reason': 'Hậu xử lý phát hiện bất thường: ' + '; '.join(postprocess_flags)}
    probs = [getattr(segment, 'no_speech_prob', None) for segment in segments]
    probs = [prob for prob in probs if isinstance(prob, (int, float))]
    log_probs = [getattr(segment, 'avg_logprob', None) for segment in segments]
    log_probs = [prob for prob in log_probs if isinstance(prob, (int, float))]
    ratios = [getattr(segment, 'compression_ratio', None) for segment in segments]
    ratios = [ratio for ratio in ratios if isinstance(ratio, (int, float))]
    if ((probs and max(probs) >= 0.60)
            or (log_probs and min(log_probs) < -1.20)
            or (ratios and max(ratios) >= 2.40)):
        # Estimate confidence from avg_logprob when available (logprob → probability)
        import math
        conf = round(math.exp(sum(log_probs) / len(log_probs)), 3) if log_probs else 0.35
        conf = max(0.10, min(0.55, conf))
        return {'level': 'low', 'needs_review': True, 'confidence': conf,
                'reason': 'Đoạn có tín hiệu nhận dạng không ổn định; phải soát kỹ bên, phủ định, số đo và đơn vị.'}
    if probs and max(probs) >= 0.35:
        return {'level': 'caution', 'needs_review': True, 'confidence': 0.65,
                'reason': 'Có khả năng im lặng hoặc từ không rõ; kiểm tra lại đoạn nhận dạng.'}
    # All clear – blend postprocess confidence with Whisper signal
    final_conf = round(postprocess_confidence * 0.9 + 0.95 * 0.1, 3) if postprocess_confidence < 0.95 else 0.95
    return {'level': 'ok', 'needs_review': False, 'confidence': final_conf, 'reason': ''}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # No request/audio/transcript logs.

    def reply(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        return secrets.compare_digest(self.headers.get('X-Vu-Key', ''), KEY)

    def do_GET(self):
        if not self.authorized():
            return self.reply(403, {'error': 'Forbidden'})
        if self.path != '/health':
            return self.reply(404, {'error': 'Not found'})
        self.reply(200, state)

    def do_POST(self):
        if not self.authorized():
            return self.reply(403, {'error': 'Forbidden'})
        if self.path != '/transcribe':
            return self.reply(404, {'error': 'Not found'})
        if not state['ready']:
            return self.reply(503, {'error': state['error'] or 'Model đang khởi động. Thử lại sau.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self.reply(400, {'error': 'Invalid length'})
        if not 44 < length <= 960044:
            return self.reply(413, {'error': 'Audio quá dài.'})
        if not LOCK.acquire(blocking=False):
            return self.reply(429, {'error': 'Máy đang chép ở tab khác. Đợi rồi thử lại.'})
        try:
            self.connection.settimeout(20)
            result = transcribe(self.rfile.read(length), final=self.headers.get('X-Vu-Final', '1') != '0')
            self.reply(200, result)
        except (ValueError, wave.Error, EOFError):
            self.reply(400, {'error': 'Đoạn âm thanh không hợp lệ.'})
        except Exception:
            self.reply(500, {'error': 'Chưa chép được đoạn âm thanh. Hãy thử lại.'})
        finally:
            LOCK.release()

if __name__ == '__main__':
    threading.Thread(target=load_model, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', 4181), Handler).serve_forever()
