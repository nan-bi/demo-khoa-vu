"""Speech decoding contract without downloading/loading model weights."""
import importlib.util
import io
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
import wave
import numpy as np
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import speech_config

class PhoWhisperTests(unittest.TestCase):
    def test_pinned_profile(self):
        self.assertEqual(speech_config.CONFIG['default'], 'small')
        for name in ['base', 'small']:
            p = speech_config.profile(name)
            self.assertEqual(p['repository'], 'vinai/PhoWhisper-' + name)
            self.assertEqual(len(p['revision']), 40)
            self.assertTrue(speech_config.model_path(p).is_relative_to(ROOT / 'speech-models'))
        with self.assertRaises(ValueError): speech_config.profile('../unknown')

    def test_decoding_never_translates_or_invents_prompt(self):
        for final, beam in [(False, 1), (True, 5)]:
            opts = speech_config.decode_options(final)
            self.assertEqual(opts['language'], 'vi')
            self.assertEqual(opts['task'], 'transcribe')
            self.assertEqual(opts['beam_size'], beam)
            self.assertEqual(opts['temperature'], 0)
            self.assertFalse(opts['condition_on_previous_text'])
            self.assertNotIn('initial_prompt', opts)

    def test_server_preserves_raw_text_and_validates_wav(self):
        fake = types.ModuleType('faster_whisper')
        fake.WhisperModel = object
        with patch.dict(sys.modules, {'faster_whisper': fake}), patch.dict(os.environ, {'VU_VOICE_KEY':'unit-test-only'}):
            spec = importlib.util.spec_from_file_location('speech_server_test', ROOT / 'scripts/speech-server.py')
            server = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(server)
        calls = []
        def transcribe(audio, **kwargs):
            calls.append(kwargs)
            return iter([types.SimpleNamespace(text=' Không thấy khối. '), types.SimpleNamespace(text=' 12 x 8 mm. ')]), None
        server.model = types.SimpleNamespace(transcribe=transcribe)
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b'\0\0' * 1600)
        data = audio.getvalue()
        result = server.transcribe(data, final=False)
        self.assertEqual(result['text'], 'Không thấy khối. 12 x 8 mm.')
        self.assertFalse(result['final'])
        self.assertEqual(calls[-1]['beam_size'], 1)
        server.transcribe(data)
        self.assertEqual(calls[-1]['beam_size'], 5)
        with self.assertRaises((wave.Error, EOFError)): server.transcribe(b'not wav')

    def test_quality_gate_surfaces_uncertainty_without_rewriting_text(self):
        fake = types.ModuleType('faster_whisper')
        fake.WhisperModel = object
        with patch.dict(sys.modules, {'faster_whisper': fake}), patch.dict(os.environ, {'VU_VOICE_KEY':'unit-test-only'}):
            spec = importlib.util.spec_from_file_location('speech_server_quality_test', ROOT / 'scripts/speech-server.py')
            server = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(server)
        uncertain = types.SimpleNamespace(no_speech_prob=0.7, avg_logprob=-0.2, compression_ratio=1.1)
        quality = server.assess_quality([uncertain], 'Vú trái không thấy khối.')
        self.assertTrue(quality['needs_review'])
        self.assertEqual(quality['level'], 'low')
        self.assertEqual(server.assess_quality([], '')['level'], 'silent')

    def test_vad_options_configured_for_noisy_rapid_speech(self):
        opts = speech_config.decode_options(True)
        vad = opts['vad_parameters']
        self.assertEqual(vad['threshold'], 0.45)
        self.assertEqual(vad['min_speech_duration_ms'], 100)
        self.assertEqual(vad['min_silence_duration_ms'], 450)
        self.assertEqual(vad['speech_pad_ms'], 350)

    def test_audio_preprocessing_gain_and_filter(self):
        fake = types.ModuleType('faster_whisper')
        fake.WhisperModel = object
        with patch.dict(sys.modules, {'faster_whisper': fake}), patch.dict(os.environ, {'VU_VOICE_KEY':'unit-test-only'}):
            spec = importlib.util.spec_from_file_location('speech_server_prep_test', ROOT / 'scripts/speech-server.py')
            server = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(server)
        captured = []
        def transcribe(samples, **kwargs):
            captured.append(samples)
            return iter([types.SimpleNamespace(text='Test')]), None
        server.model = types.SimpleNamespace(transcribe=transcribe)

        audio = io.BytesIO()
        import numpy as np
        t = np.linspace(0, 0.1, 1600, dtype=np.float32)
        sine = (0.05 * np.sin(2 * np.pi * 500 * t) + 0.02)
        raw_int16 = (sine * 32767).astype(np.int16).tobytes()
        with wave.open(audio, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(raw_int16)
        server.transcribe(audio.getvalue(), final=True)

        proc = captured[0]
        self.assertAlmostEqual(float(np.mean(proc)), 0.0, places=2)
        self.assertGreater(float(np.max(np.abs(proc))), 0.2)

if __name__ == '__main__': unittest.main()
