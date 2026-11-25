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
    (re.compile(r'\bbai\s*rát\b', re.I), 'BI-RADS'),
    (re.compile(r'\bbai\s*rat\b', re.I), 'BI-RADS'),
    (re.compile(r'\bbirát\b', re.I), 'BI-RADS'),
    (re.compile(r'\bbirat\b', re.I), 'BI-RADS'),
    # Ultrasound modalities
    (re.compile(r'\bsiêu\s+am\b', re.I), 'siêu âm'),
    (re.compile(r'\bdóp\s*ple\b', re.I), 'Doppler'),
    (re.compile(r'\bdóp\s*pơ\b', re.I), 'Doppler'),
    (re.compile(r'\bdôp\s*ple\b', re.I), 'Doppler'),
    # Tissue / pathology
    (re.compile(r'\bsinh\s+ti[eệ][tc]\b', re.I | re.UNICODE), 'sinh thiết'),
    (re.compile(r'\bsinh\s+tiết\b', re.I), 'sinh thiết'),
    (re.compile(r'\bgiai\s+phẫu\b', re.I), 'giải phẫu'),
    (re.compile(r'\bgiai\s+phẩu\b', re.I), 'giải phẫu'),
    # Laterality (high-risk; only correct obvious phonetic swaps)
    (re.compile(r'\bphải\s+trái\b', re.I), 'phải-trái'),   # keeps both, adds dash
    # Common clinical abbreviations spoken phonetically
    (re.compile(r'\bác\s+tính\b', re.I), 'ác tính'),
    (re.compile(r'\blành\s+tin\b', re.I), 'lành tính'),
    (re.compile(r'\bkhôi\b', re.I), 'khối'),
    # Numbers spoken as words → digits (only clear, single digit words)
    (re.compile(r'\bmột\s+(mm|cm)\b', re.I), r'1 \1'),
    (re.compile(r'\bhai\s+(mm|cm)\b', re.I), r'2 \1'),
    (re.compile(r'\bba\s+(mm|cm)\b', re.I), r'3 \1'),
    (re.compile(r'\bbốn\s+(mm|cm)\b', re.I), r'4 \1'),
    (re.compile(r'\bnăm\s+(mm|cm)\b', re.I), r'5 \1'),
    (re.compile(r'\bsáu\s+(mm|cm)\b', re.I), r'6 \1'),
    (re.compile(r'\bbảy\s+(mm|cm)\b', re.I), r'7 \1'),
    (re.compile(r'\btám\s+(mm|cm)\b', re.I), r'8 \1'),
    (re.compile(r'\bchín\s+(mm|cm)\b', re.I), r'9 \1'),
    (re.compile(r'\bmười\s+(mm|cm)\b', re.I), r'10 \1'),
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

    original = text
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
        def _replace_term(m: re.Match, r: str = replacement, pat: re.Pattern = pattern) -> str:
            result = pat.sub(r, m.group(0))
            corrections.append(f"Thuật ngữ: '{m.group(0)}' → '{result}'")
            return result
        new_text = pattern.sub(lambda m: _sub_and_log(m, replacement, corrections), text)
        text = new_text

    # -- Step 4: quality flags (never change text, just warn)
    if not _HAS_VI_DIACRITIC.search(text) and len(text) > 10:
        flags.append('Không có dấu tiếng Việt: có thể ghi âm bị nhiễu hoặc model nhầm ngôn ngữ. Soát lại.')

    if _is_repetitive(text):
        flags.append('Lặp từ bất thường: có thể là ảo giác (hallucination) của model. Soát kỹ hoặc yêu cầu đọc lại.')

    if original == text:
        pass  # no changes needed

    return {'text': text.strip(), 'corrections': corrections, 'flags': flags}


def _sub_and_log(m: re.Match, replacement: str, log: list[str]) -> str:
    """Apply substitution and append to log."""
    # Handle backreferences in replacement like r'1 \1'
    result = m.re.sub(replacement, m.group(0))
    if result != m.group(0):
        log.append(f"Thuật ngữ: '{m.group(0)}' → '{result}'")
    return result


if __name__ == '__main__':
    # Quick self-test
    cases = [
        ("Khối 12 mi li mét nhân 8 mi li mét tại vú phải, siêu am không phát hiện bai rát 4.", {}),
        ("Sinh tiệc lành tính, siêu âm bi rát 3.", {}),
        ("khôi kích thước mười hai mi li mét.", {}),
    ]
    for text, _ in cases:
        r = postprocess(text)
        print('IN :', text)
        print('OUT:', r['text'])
        if r['corrections']:
            print('FIX:', r['corrections'])
        if r['flags']:
            print('FLAG:', r['flags'])
        print()
