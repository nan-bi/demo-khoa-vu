"""Pinned local PhoWhisper profiles; never silently substitute a model."""
import json
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'scripts/speech-models.json').read_text(encoding='utf-8'))
def profile(name=None):
    name = name or os.environ.get('VU_SPEECH_MODEL') or CONFIG['default']
    if name not in CONFIG['models']:
        raise ValueError('VU_SPEECH_MODEL must be base or small')
    return dict(CONFIG['models'][name], name=name)
def model_path(selected):
    return ROOT / 'speech-models' / selected['directory']
def decode_options(final=True):
    return dict(language='vi', task='transcribe', beam_size=5 if final else 1,
                temperature=0, condition_on_previous_text=False,
                no_speech_threshold=0.55,
                log_prob_threshold=-1.0,
                compression_ratio_threshold=2.2,
                vad_filter=True,
                vad_parameters={'threshold': 0.45,
                                'min_speech_duration_ms': 100,
                                'min_silence_duration_ms': 450,
                                'speech_pad_ms': 350},
                hallucination_silence_threshold=2)
