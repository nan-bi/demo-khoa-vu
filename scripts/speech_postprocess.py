"""Post-processing for PhoWhisper transcript: medical term normalization and measurement fixing.

Design rules (medical safety):
- Never silently rewrite a clinical term if ambiguous. Only correct clear transcription
  artefacts (phonetic near-misses, ASCII/Unicode swaps, digit words).
- Every substitution is logged to `corrections` list for physician review.
- Do NOT change negation words, laterality, or numbers unless the pattern is unambiguous.
- Rules are deterministic: same input always yields same output (no AI guessing).
"""
from __future__ import annotations
import re

# ---------------------------------------------------------------------------
# 1. Measurement normalization
#    PhoWhisper often transcribes units as separate words or omits the × symbol.
# ---------------------------------------------------------------------------
_UNIT_ALIASES = {
    'milimét': 'mm', 'mili mét': 'mm', 'mi li mét': 'mm', 'milimet': 'mm',
    'centimét': 'cm', 'centi mét': 'cm', 'centimet': 'cm',
    'centilít': 'ml', 'mililít': 'ml',
    'micrô mét': 'µm', 'micromet': 'µm',
}

# Pattern: "12 mi li mét" → "12 mm"  (number + unit alias)
_UNIT_PATTERN = re.compile(
    r'(\d+(?:[.,]\d+)?)\s+(' + '|'.join(re.escape(k) for k in _UNIT_ALIASES) + r')',
    re.IGNORECASE | re.UNICODE,
)

# Pattern: "12 x 8 mm" or "12 mm x 8 mm" → keep as-is (already correct)
# Pattern: "12 nhân 8 mm" → "12 × 8 mm"
_TIMES_PATTERN = re.compile(
    r'(\d+(?:[.,]\d+)?\s*(?:mm|cm|µm)?)\s+(?:nhân|x|×|X)\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|µm)?)',
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# 2. Medical term corrections (phonetic near-misses only)
#    Key: lowercase regex pattern  Value: replacement (preserve case of first word)
#    SAFETY: only unambiguous one-to-one phonetic errors are listed here.
# ---------------------------------------------------------------------------
_TERM_CORRECTIONS: list[tuple[re.Pattern, str]] = [
    # Bi-rad / BI-RADS scoring
    (re.compile(r'\b(?:bai\s*r[aá]t|bir[aá]t)\b', re.I), 'BI-RADS'),
    # Ultrasound modalities
    (re.compile(r'\bsiêu\s+am\b', re.I), 'siêu âm'),
    (re.compile(r'\b(?:dóp\s*ple|dóp\s*pơ|dôp\s*ple)\b', re.I), 'Doppler'),
    # Tissue / pathology
    (re.compile(r'\bsinh\s+ti(?:[eệ][tc]|ết)\b', re.I | re.UNICODE), 'sinh thiết'),
    (re.compile(r'\bgiai\s+ph[ẫẩ]u\b', re.I), 'giải phẫu'),
    # Laterality (high-risk; only correct obvious phonetic swaps)
    (re.compile(r'\bphải\s+trái\b', re.I), 'phải-trái'),
    # Common clinical abbreviations spoken phonetically
    (re.compile(r'\blành\s+tin\b', re.I), 'lành tính'),
    (re.compile(r'\bkhôi\b', re.I), 'khối'),
    # Numbers spoken as words → digits (only clear, single digit words)
    *[
        (re.compile(rf'\b{word}\s+(mm|cm)\b', re.I), rf'{digit} \1')
        for word, digit in (
            ('một', '1'), ('hai', '2'), ('ba', '3'), ('bốn', '4'), ('năm', '5'),
            ('sáu', '6'), ('bảy', '7'), ('tám', '8'), ('chín', '9'), ('mười', '10'),
        )
    ],
]

# ---------------------------------------------------------------------------
# 3. Sentence-level quality heuristics (non-rewriting checks)
# ---------------------------------------------------------------------------
# Flag if no Vietnamese tone mark at all (possible garbled noise output)
_HAS_VI_DIACRITIC = re.compile(r'[àáảãạăắặằẳẵâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]', re.UNICODE)

# Flag if pure repetition (Whisper hallucination artifact)
def _is_repetitive(text: str, threshold: float = 0.6) -> bool:
    words = text.lower().split()
    if len(words) < 6:
        return False
    unique = len(set(words))
    return unique / len(words) < (1 - threshold)


def postprocess(text: str) -> dict:
    """
    Returns:
        {
          'text': str,              # corrected transcript
          'corrections': list[str], # human-readable log of changes
          'flags': list[str],       # quality warnings for physician review
        }
    """
    if not text or not text.strip():
        return {'text': text, 'corrections': [], 'flags': ['Đoạn trống hoặc chỉ có khoảng trắng.']}

    corrections: list[str] = []
    flags: list[str] = []

    # -- Step 1: unit alias normalization
    def _replace_unit(m: re.Match) -> str:
        num, unit_text = m.group(1), m.group(2).lower()
        replacement = f"{num} {_UNIT_ALIASES.get(unit_text, unit_text)}"
        corrections.append(f"Đơn vị: '{m.group(0)}' → '{replacement}'")
        return replacement

    text = _UNIT_PATTERN.sub(_replace_unit, text)

    # -- Step 2: measurement cross symbol
    def _replace_times(m: re.Match) -> str:
        result = m.group(0).replace('nhân', '×').replace(' x ', ' × ').replace(' X ', ' × ')
        if result != m.group(0):
            corrections.append(f"Ký hiệu nhân: '{m.group(0)}' → '{result}'")
        return result

    text = _TIMES_PATTERN.sub(_replace_times, text)

    # -- Step 3: medical term corrections
    for pattern, replacement in _TERM_CORRECTIONS:
        text = pattern.sub(lambda m: _sub_and_log(m, replacement, corrections), text)

    # -- Step 4: quality flags (never change text, just warn)
    if not _HAS_VI_DIACRITIC.search(text) and len(text) > 10:
        flags.append('Không có dấu tiếng Việt: có thể ghi âm bị nhiễu hoặc model nhầm ngôn ngữ. Soát lại.')

    if _is_repetitive(text):
        flags.append('Lặp từ bất thường: có thể là ảo giác (hallucination) của model. Soát kỹ hoặc yêu cầu đọc lại.')

    return {'text': text.strip(), 'corrections': corrections, 'flags': flags}


def _sub_and_log(m: re.Match, replacement: str, log: list[str]) -> str:
    """Apply substitution and append to log."""
    # Handle backreferences in replacement like r'1 \1'
    result = m.re.sub(replacement, m.group(0))
    if result != m.group(0):
        log.append(f"Thuật ngữ: '{m.group(0)}' → '{result}'")
    return result
