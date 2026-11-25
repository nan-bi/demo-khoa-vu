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

def transcribe(data, final=True):
    # Only PCM WAV created by our client: mono, 16 kHz, at most 30 seconds.
    with wave.open(io.BytesIO(data), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
            raise ValueError('Expected mono PCM16 16kHz')
        nframes = audio.getnframes()
        if not 0 < nframes <= 30 * 16000:
            raise ValueError('Audio duration out of range')
        raw_frames = audio.readframes(nframes)
    # Convert PCM16 to float32 samples [-1.0, 1.0]
    samples = np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32768.0

    # 1. Attenuate low-frequency rumble and DC offset (fan motor / 50Hz AC hum < 85Hz)
    if len(samples) >= 188:
        rumble = np.convolve(samples, np.ones(188, dtype=np.float32) / 188.0, mode='same')
        samples = samples - rumble

    # 2. Dynamic gain boost for weak microphones (peak amplitude < 0.5)
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    if 0.01 < peak < 0.5:
        # Scale up to 0.75 target, capped at 5x (+14 dB) to prevent clipping
        samples = samples * min(0.75 / peak, 5.0)

    started = time.perf_counter()
    segments, _ = model.transcribe(samples, **decode_options(final))
    decoded = list(segments)
    raw_text = ' '.join(s.text.strip() for s in decoded).strip()

    # Post-process: normalize medical terminology and measurement units.
    # Corrections are logged for physician review; clinical text is never
    # silently altered without an explicit, deterministic, logged rule.
    post = postprocess(raw_text) if final else {'text': raw_text, 'corrections': [], 'flags': []}
    text = post['text']

    quality = assess_quality(decoded, text, post['flags'])
    return {'text': text, 'seconds': round(time.perf_counter() - started, 3),
            'model': state['model'], 'revision': PROFILE['revision'], 'final': final,
            'needs_review': quality['needs_review'], 'quality': quality['level'],
            'quality_reason': quality['reason'],
            'corrections': post['corrections'],
            'raw_text': raw_text if post['corrections'] else None}


def assess_quality(segments, text, postprocess_flags=None):
    """Surface uncertainty; never rewrite clinical terms automatically."""
    if not text.strip():
        return {'level': 'silent', 'needs_review': True,
                'reason': 'Không phát hiện lời đọc rõ ràng hoặc đoạn chỉ có im lặng.'}
    if postprocess_flags:
        return {'level': 'caution', 'needs_review': True,
                'reason': 'Hậu xử lý phát hiện bất thường: ' + '; '.join(postprocess_flags)}
    probs = [getattr(segment, 'no_speech_prob', None) for segment in segments]
    probs = [prob for prob in probs if isinstance(prob, (int, float))]
    log_probs = [getattr(segment, 'avg_logprob', None) for segment in segments]
    log_probs = [prob for prob in log_probs if isinstance(prob, (int, float))]
    ratios = [getattr(segment, 'compression_ratio', None) for segment in segments]
    ratios = [ratio for ratio in ratios if isinstance(ratio, (int, float))]
    if ((probs and max(probs) >= 0.60)
            or (log_probs and max(log_probs) < -1.20)
            or (ratios and max(ratio for ratio in ratios) >= 2.40)):
        return {'level': 'low', 'needs_review': True,
                'reason': 'Đoạn có tín hiệu nhận dạng không ổn định; phải soát kỹ bên, phủ định, số đo và đơn vị.'}
    if probs and max(probs) >= 0.35:
        return {'level': 'caution', 'needs_review': True,
                'reason': 'Có khả năng im lặng hoặc từ không rõ; kiểm tra lại đoạn nhận dạng.'}
    return {'level': 'ok', 'needs_review': False, 'reason': ''}

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
