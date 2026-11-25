"""Post-processing for PhoWhisper transcript: medical term normalization and measurement fixing.

Design rules (medical safety):
- Never silently rewrite a clinical term if ambiguous. Only correct clear transcription
  artefacts (phonetic near-misses, ASCII/Unicode swaps, digit words).
- Every substitution is logged to `corrections` list for physician review.
- Do NOT change negation words, laterality, or numbers unless the pattern is unambiguous.
- Rules are deterministic: same input always yields same output (no AI guessing).

Regional accent coverage (v2):
  Southern: s/x swap, hỏi↔sắc/ngã conflation, dropped tone marks, cuối từ ng→n
  Central : ươ↔ơ collapse, ô/o short, ai/ơi swap in some clusters
  Northern: d/gi/r homophones, final ng elision, ă/â conflation
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

_UNIT_PATTERN = re.compile(
    r'(\d+(?:[.,]\d+)?)\s+(' + '|'.join(re.escape(k) for k in _UNIT_ALIASES) + r')',
    re.IGNORECASE | re.UNICODE,
)

_TIMES_PATTERN = re.compile(
    r'(\d+(?:[.,]\d+)?\s*(?:mm|cm|µm)?)\s+(?:nhân|x|×|X)\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|µm)?)',
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# 2. Regional accent phonetic substitution rules
#    Applied BEFORE general term corrections so the resulting canonical form
#    can then be caught by the medical-term rules below.
#    Keys are lowercase regex; values are canonical replacements.
#    SAFETY: only unambiguous one-to-one phoneme errors listed here.
# ---------------------------------------------------------------------------

# -- 2a. Southern Vietnamese (Miền Nam) --
# s ↔ x word-initial swap in medical words
# hỏi ↔ sắc tone conflation on specific syllables
# Word-final 'ng' ↓ n (e.g. "khôn" → "không")
_SOUTHERN_RULES: list[tuple[re.Pattern, str]] = [
    # "siêu xm" / "xâu âm" → "siêu âm" (x/s swap)
    (re.compile(r'\bxiêu\s+âm\b', re.I | re.U), 'siêu âm'),
    (re.compile(r'\bsiêu\s+xm\b', re.I | re.U), 'siêu âm'),
    # "xét nghiêm" → "xét nghiệm" (dropped diacritics in final syllable)
    (re.compile(r'\bxét\s+nghiêm\b', re.I | re.U), 'xét nghiệm'),
    # "sinh tiêt" → "sinh thiết" (s/th swap, missing tone)
    (re.compile(r'\bsinh\s+ti[eê]t\b', re.I | re.U), 'sinh thiết'),
    # "u xơ" → "u xơ" is correct; but "u sơ" is Southern slip
    (re.compile(r'\bu\s+sơ\b', re.I | re.U), 'u xơ'),
    # "khôn" → "không" (dropped final ng)
    (re.compile(r'\bkhôn\b(?!\s+khổ)', re.I | re.U), 'không'),
    # "nhủ hoa" → "nhũ hoa" (hỏi→ngã flip)
    (re.compile(r'\bnhủ\s+hoa\b', re.I | re.U), 'nhũ hoa'),
    # "vú phải" mis-heard as "bú phải" (b/v swap – Southern labial)
    (re.compile(r'\bbú\s+(phải|trái|hai)\b', re.I | re.U), r'vú \1'),
    # "ác tinh" / "ac tính" → "ác tính"
    (re.compile(r'\bác\s+tinh\b', re.I | re.U), 'ác tính'),
    (re.compile(r'\bac\s+tính\b', re.I | re.U), 'ác tính'),
    # "lanh tinh" → "lành tính" (muted diacritics)
    (re.compile(r'\blanh\s+tinh\b', re.I | re.U), 'lành tính'),
    # "cục" mis-heard as "gục" (g/c initial – Southern cluster)
    (re.compile(r'\bgục\s+(u\b|nhỏ\b|lớn\b)', re.I | re.U), r'cục \1'),
    # "nốt" missed accent: "not vôi" → "nốt vôi"
    (re.compile(r'\bnot\s+vôi\b', re.I | re.U), 'nốt vôi'),
]

# -- 2b. Central Vietnamese (Miền Trung) --
# ươ↔ơ collapse, ai/ơi/i conflation in certain positions
_CENTRAL_RULES: list[tuple[re.Pattern, str]] = [
    # "bướu" → "bướu" correct; "bưu" → "bướu" (Central drops ơ in ươ)
    (re.compile(r'\bbưu\b', re.I | re.U), 'bướu'),
    # "khôi u" → "khối u"
    (re.compile(r'\bkhôi\s+u\b', re.I | re.U), 'khối u'),
    # "siêu ôm" → "siêu âm" (ô/â Central conflation)
    (re.compile(r'\bsiêu\s+ôm\b', re.I | re.U), 'siêu âm'),
    # "giải fẫu" → "giải phẫu" (ph→f Central)
    (re.compile(r'\bgiải\s+f[aăâ]u\b', re.I | re.U), 'giải phẫu'),
    # "manh" → "mạnh" (dropped subdot – tone mark elision)
    (re.compile(r'\bsinh\s+manh\b', re.I | re.U), 'sinh mạnh'),
    # "u lành" mispronounced "u lanh" in Central
    (re.compile(r'\bu\s+lanh\b', re.I | re.U), 'u lành'),
    # "nang" → "nang" (correct); but "năng" → "nang" (Central ă→a)
    (re.compile(r'\bnăng\s+(nước|đơn|đôi)\b', re.I | re.U), r'nang \1'),
]

# -- 2c. Northern Vietnamese (Miền Bắc) --
# d/gi/r triphone, final ng elision specific forms, ă/â conflation
_NORTHERN_RULES: list[tuple[re.Pattern, str]] = [
    # "giải phẫu" mis-heard as "dải phẫu" or "rải phẫu" (d/gi/r homophones)
    (re.compile(r'\b[dr]ải\s+phẫu\b', re.I | re.U), 'giải phẫu'),
    # "dópler" / "rópler" → "Doppler"
    (re.compile(r'\b[dr]óp\s*l[eơ]r?\b', re.I | re.U), 'Doppler'),
    # "xét nghiem" → "xét nghiệm" (ê/iê Northern merge)
    (re.compile(r'\bxét\s+nghiem\b', re.I | re.U), 'xét nghiệm'),
    # "nhân" → "nhân" correct but "nhăn" can appear
    (re.compile(r'(\d+)\s+nhăn\s+(\d+)', re.I | re.U), r'\1 × \2'),
    # "giải fẫu bệnh" → "giải phẫu bệnh"
    (re.compile(r'\bgiải\s+f[âa]u\s+bệnh\b', re.I | re.U), 'giải phẫu bệnh'),
    # "u vú" → "u vú" (correct); "u dú" Northern d/v swap
    (re.compile(r'\bu\s+dú\b', re.I | re.U), 'u vú'),
    # "bírát" → "BI-RADS" (Northern rhotacism + no tone marks)
    (re.compile(r'\bbirát\b', re.I | re.U), 'BI-RADS'),
]

# ---------------------------------------------------------------------------
# 3. Medical term corrections (phonetic near-misses only — applies after accent)
#    SAFETY: only unambiguous one-to-one phonetic errors listed here.
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
# 4. Sentence-level quality heuristics (non-rewriting checks)
# ---------------------------------------------------------------------------
_HAS_VI_DIACRITIC = re.compile(
    r'[àáảãạăắặằẳẵâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]',
    re.UNICODE,
)

def _is_repetitive(text: str, threshold: float = 0.6) -> bool:
    words = text.lower().split()
    if len(words) < 6:
        return False
    unique = len(set(words))
    return unique / len(words) < (1 - threshold)

# Confidence score (0.0–1.0) based on how many corrections were needed.
# Used by the server to decide whether to set needs_review.
def _confidence_score(raw: str, corrected: str, corrections: list[str], flags: list[str]) -> float:
    if flags:
        return 0.40
    if not corrections:
        return 0.95
    # Each correction reduces confidence proportionally
    penalty = min(0.08 * len(corrections), 0.45)
    return round(max(0.50, 0.95 - penalty), 2)


# ---------------------------------------------------------------------------
# 5. Public API
# ---------------------------------------------------------------------------

def postprocess(text: str) -> dict:
    """
    Returns:
        {
          'text': str,              # corrected transcript
          'corrections': list[str], # human-readable log of changes (for physician)
          'flags': list[str],       # quality warnings for physician review
          'confidence': float,      # 0.0–1.0 post-correction confidence estimate
          'accent_region': str|None # detected accent region if any rule fired
        }
    """
    if not text or not text.strip():
        return {'text': text, 'corrections': [], 'flags': ['Đoạn trống hoặc chỉ có khoảng trắng.'],
                'confidence': 0.0, 'accent_region': None}

    corrections: list[str] = []
    flags: list[str] = []
    raw = text

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

    # -- Step 3: regional accent rules (run all; track which region fired)
    accent_fired: dict[str, int] = {}
    for label, rules in (('Nam', _SOUTHERN_RULES), ('Trung', _CENTRAL_RULES), ('Bắc', _NORTHERN_RULES)):
        for pattern, replacement in rules:
            before = text
            text = pattern.sub(lambda m, r=replacement: _sub_and_log(m, r, corrections), text)
            if text != before:
                accent_fired[label] = accent_fired.get(label, 0) + 1

    accent_region: str | None = None
    if accent_fired:
        accent_region = max(accent_fired, key=accent_fired.get)
        flags.append(
            f"Phát hiện đặc điểm giọng Miền {accent_region} "
            f"({accent_fired[accent_region]} chỉnh sửa). Soát lại trước khi lưu."
        )

    # -- Step 4: medical term corrections
    for pattern, replacement in _TERM_CORRECTIONS:
        text = pattern.sub(lambda m, r=replacement: _sub_and_log(m, r, corrections), text)

    # -- Step 5: quality flags (never change text, just warn)
    if not _HAS_VI_DIACRITIC.search(text) and len(text) > 10:
        flags.append('Không có dấu tiếng Việt: có thể ghi âm bị nhiễu hoặc model nhầm ngôn ngữ. Soát lại.')

    if _is_repetitive(text):
        flags.append('Lặp từ bất thường: có thể là ảo giác (hallucination) của model. Soát kỹ hoặc yêu cầu đọc lại.')

    confidence = _confidence_score(raw, text, corrections, flags)

    return {
        'text': text.strip(),
        'corrections': corrections,
        'flags': flags,
        'confidence': confidence,
        'accent_region': accent_region,
    }


def _sub_and_log(m: re.Match, replacement: str, log: list[str]) -> str:
    """Apply substitution and append to log."""
    result = m.re.sub(replacement, m.group(0))
    if result != m.group(0):
        log.append(f"Thuật ngữ: '{m.group(0)}' → '{result}'")
    return result
