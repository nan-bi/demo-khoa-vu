"""Post-processing for PhoWhisper transcript: medical term normalization,
non-medical / filler word locking, and measurement fixing.

Design rules (medical safety):
- Never silently rewrite a clinical term if ambiguous. Only correct clear transcription
  artefacts (phonetic near-misses, ASCII/Unicode swaps, digit words, real-voice errors).
- Lock and strip non-medical filler phrases & Whisper hallucinations so clinical reports
  adhere to strict medical terminology (Khoa Vú & general medicine).
- Every substitution or locked phrase is logged to `corrections` / `blocked_terms`
  for physician review.
- Do NOT change clinical negation words ("không thấy", "không có") or laterality.
- Rules are deterministic: same input always yields same output (no AI guessing).
"""
from __future__ import annotations
import re

# ---------------------------------------------------------------------------
# 1. Non-medical filler / colloquial / hallucination lock & removal
#    Locked phrases are removed from the clinical output and logged to
#    `blocked_terms` + `corrections`. Never strip clinical negation ("không").
# ---------------------------------------------------------------------------
_NON_MEDICAL_LOCK_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Spoken clinic side-talk / fillers not part of formal medical findings
    (re.compile(r'\b(?:em\s+ghi\s+tiếp\s+(?:nhé|nhá)|ghi\s+tiếp\s+(?:nhé|nhá))\b[,.\s]*', re.I | re.U), 'Lời thoại thư ký'),
    (re.compile(r'\b(?:à\s+không|ờ\s+không|ừm+|ờm+|à\s+ừ|nhá|nhé)\b[,.\s]*', re.I | re.U), 'Từ đệm hội thoại'),
    # Whisper YouTube / media hallucinations
    (re.compile(r'(?:hãy\s+subscribe|đăng\s+ký\s+kênh|cảm\s+ơn\s+(?:các\s+bạn\s+)?đã\s+xem|video\s+tiếp\s+theo|phụ\s+đề\s+bởi|lời\s+bài\s+hát)[^.?!]*[.?!]?', re.I | re.U), 'Ảo giác ngoài y khoa'),
]

# ---------------------------------------------------------------------------
# 2. Measurement normalization
# ---------------------------------------------------------------------------
_UNIT_ALIASES = {
    'milimét': 'mm', 'mili mét': 'mm', 'mi li mét': 'mm', 'milimet': 'mm',
    'centimét': 'cm', 'centi mét': 'cm', 'centimet': 'cm', 'xen ti mét': 'cm',
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

_DIGIT_WORDS = {
    'không': '0', 'một': '1', 'hai': '2', 'ba': '3', 'bốn': '4',
    'năm': '5', 'sáu': '6', 'bảy': '7', 'tám': '8', 'chín': '9', 'mười': '10',
}

# ---------------------------------------------------------------------------
# 3. Regional accent phonetic substitution rules
# ---------------------------------------------------------------------------
_SOUTHERN_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bxiêu\s+âm\b', re.I | re.U), 'siêu âm'),
    (re.compile(r'\bsiêu\s+xm\b', re.I | re.U), 'siêu âm'),
    (re.compile(r'\bxét\s+nghiêm\b', re.I | re.U), 'xét nghiệm'),
    (re.compile(r'\bsinh\s+ti[eê]t\b', re.I | re.U), 'sinh thiết'),
    (re.compile(r'\bu\s+sơ\b', re.I | re.U), 'u xơ'),
    (re.compile(r'\bkhôn\b(?!\s+khổ)', re.I | re.U), 'không'),
    (re.compile(r'\bnhủ\s+hoa\b', re.I | re.U), 'nhũ hoa'),
    (re.compile(r'\bbú\s+(phải|trái|hai)\b', re.I | re.U), r'vú \1'),
    (re.compile(r'\bác\s+tinh\b', re.I | re.U), 'ác tính'),
    (re.compile(r'\bac\s+tính\b', re.I | re.U), 'ác tính'),
    (re.compile(r'\blanh\s+tinh\b', re.I | re.U), 'lành tính'),
    (re.compile(r'\bgục\s+(u\b|nhỏ\b|lớn\b)', re.I | re.U), r'cục \1'),
    (re.compile(r'\bnot\s+vôi\b', re.I | re.U), 'nốt vôi'),
]

_CENTRAL_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bbưu\b', re.I | re.U), 'bướu'),
    (re.compile(r'\bkhôi\s+u\b', re.I | re.U), 'khối u'),
    (re.compile(r'\bsiêu\s+ôm\b', re.I | re.U), 'siêu âm'),
    (re.compile(r'\bgiải\s+f[aăâ]u\b', re.I | re.U), 'giải phẫu'),
    (re.compile(r'\bsinh\s+manh\b', re.I | re.U), 'sinh mạnh'),
    (re.compile(r'\bu\s+lanh\b', re.I | re.U), 'u lành'),
    (re.compile(r'\bnăng\s+(nước|đơn|đôi)\b', re.I | re.U), r'nang \1'),
]

_NORTHERN_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\b[dr]ải\s+phẫu\b', re.I | re.U), 'giải phẫu'),
    (re.compile(r'\b[dr]óp\s*l[eơ]r?\b', re.I | re.U), 'Doppler'),
    (re.compile(r'\bxét\s+nghiem\b', re.I | re.U), 'xét nghiệm'),
    (re.compile(r'(\d+)\s+nhăn\s+(\d+)', re.I | re.U), r'\1 × \2'),
    (re.compile(r'\bgiải\s+f[âa]u\s+bệnh\b', re.I | re.U), 'giải phẫu bệnh'),
    (re.compile(r'\bu\s+dú\b', re.I | re.U), 'u vú'),
    (re.compile(r'\bbirát\b', re.I | re.U), 'BI-RADS'),
]

# ---------------------------------------------------------------------------
# 4. Real-voice & cross-specialty medical term corrections
#    Derived directly from real recordings in 'speech data/' + standard
#    Khoa Vú & general medical terminology.
# ---------------------------------------------------------------------------
_TERM_CORRECTIONS: list[tuple[re.Pattern, str]] = [
    # -- Breast density types (observed in t0 ho, t1 n) --
    (re.compile(r'\btype\s*([a-d])\b', re.I | re.U), lambda m: f'type {m.group(1).upper()}'),
    (re.compile(r'\b(?:tuýp|típ)\s+([a-d])\b', re.I | re.U), lambda m: f'type {m.group(1).upper()}'),
    (re.compile(r'\btháp\s+a\b', re.I | re.U), 'type A'),
    (re.compile(r'\btiếp\s+xe\b', re.I | re.U), 'type C'),

    # -- Breast anatomy & laterality (observed in t0 ho, t1 hu, t2 ha, t3 m, t3 o, t4 l) --
    (re.compile(r'\btiếng\s+vú\s+(?:cháy|trái)\b', re.I | re.U), 'tuyến vú trái'),
    (re.compile(r'\btiếng\s+vú\b', re.I | re.U), 'tuyến vú'),
    (re.compile(r'\btuyến\s+(?:vụ|vũ)\b', re.I | re.U), 'tuyến vú'),
    (re.compile(r'\b(?:vú|vụ)\s+cháy\b', re.I | re.U), 'vú trái'),
    (re.compile(r'\bvụ\s+(phải|trái|hai)\b', re.I | re.U), r'vú \1'),
    (re.compile(r'\bv\s+(phải|trái)\b', re.I | re.U), r'vú \1'),
    (re.compile(r'\b(?:nhùng|ngùng)\s+vú\b', re.I | re.U), 'núm vú'),

    # -- BI-RADS & Cooper & Doppler (observed in t1 hu, t2 ha) --
    (re.compile(r'\b(?:bai\s*r[aá]t|bir[aá]t|bi\s*r[aá]t|bi\s*đắt|bi\s*lát)\b', re.I | re.U), 'BI-RADS'),
    (re.compile(r'\bBI-RADS\s+(không|một|hai|ba|bốn|năm)\b', re.I | re.U),
     lambda m: f"BI-RADS {_DIGIT_WORDS.get(m.group(1).lower(), m.group(1))}"),
    (re.compile(r'\b(?:cốp\s*bô|cu\s*pơ|cúp\s*pơ|cốp\s*pơ)\b', re.I | re.U), 'Cooper'),
    (re.compile(r'\b(?:dóp\s*ple|dóp\s*pơ|dôp\s*ple|đốp\s*lơ)\b', re.I | re.U), 'Doppler'),

    # -- Ultrasound & parenchymal terms (observed in t0 ho, t1 hu, t2 ha, t4 l) --
    (re.compile(r'\b(?:siêu\s+am|xe\s+âm)\b', re.I | re.U), 'siêu âm'),
    (re.compile(r'\b(?:nhôm\s+mô|như\s+mô)\b', re.I | re.U), 'nhu mô'),
    (re.compile(r'\bchống\s+âm\b', re.I | re.U), 'trống âm'),
    (re.compile(r'\bhôi\s+âm\b', re.I | re.U), 'hồi âm'),
    (re.compile(r'\blẫn\s+cợt\b', re.I | re.U), 'lợn cợn'),
    (re.compile(r'\bcạn\s+dịch\b', re.I | re.U), 'cặn dịch'),
    (re.compile(r'\bdải\s+rác\b', re.I | re.U), 'rải rác'),
    (re.compile(r'\bđịnh\s+kỷ\b', re.I | re.U), 'định kỳ'),
    (re.compile(r'\bchỗ\s+nhú\b', re.I | re.U), 'chồi nhú'),
    (re.compile(r'\bvị\s+chín\b', re.I | re.U), 'vị trí'),
    (re.compile(r'\bchục\s+thẳng\s+đứng\b', re.I | re.U), 'trục thẳng đứng'),
    (re.compile(r'\bbởi\s+(đều|rõ)\b', re.I | re.U), r'bờ \1'),
    (re.compile(r'\b(thành|bờ)\s+nhãn\b', re.I | re.U), r'\1 nhẵn'),

    # -- Pathology & general medical terms (Khoa Vú & Đa khoa) --
    (re.compile(r'\bsinh\s+ti(?:[eệ][tc]|ết)\b', re.I | re.UNICODE), 'sinh thiết'),
    (re.compile(r'\bgiai\s+ph[ẫẩ]u\b', re.I | re.U), 'giải phẫu'),
    (re.compile(r'\bchẩn\s+do[aá]n\b', re.I | re.U), 'chẩn đoán'),
    (re.compile(r'\bhuyết\s+ap\b', re.I | re.U), 'huyết áp'),
    (re.compile(r'\bnội\s+xoi\b', re.I | re.U), 'nội soi'),
    (re.compile(r'\bphải\s+trái\b', re.I | re.U), 'phải-trái'),
    (re.compile(r'\blành\s+tin\b', re.I | re.U), 'lành tính'),
    (re.compile(r'\bkhôi\b', re.I | re.U), 'khối'),

    # -- Numbers spoken as words before units -> digits --
    *[
        (re.compile(rf'\b{word}\s+(mm|cm)\b', re.I), rf'{digit} \1')
        for word, digit in (
            ('một', '1'), ('hai', '2'), ('ba', '3'), ('bốn', '4'), ('năm', '5'),
            ('sáu', '6'), ('bảy', '7'), ('tám', '8'), ('chín', '9'), ('mười', '10'),
        )
    ],
]

# ---------------------------------------------------------------------------
# 5. Sentence-level quality & medical-standard heuristics
# ---------------------------------------------------------------------------
_HAS_VI_DIACRITIC = re.compile(
    r'[àáảãạăắặằẳẵâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]',
    re.UNICODE,
)

_MEDICAL_STANDARD_TERMS = re.compile(
    r'\b(?:siêu âm|tuyến vú|vú phải|vú trái|nhu mô|hạch|ống tuyến|Cooper|BI-RADS|'
    r'Doppler|giảm âm|trống âm|tăng âm|nang|u xơ|u sợi|sinh thiết|giải phẫu|'
    r'nhũ ảnh|chẩn đoán|kết luận|lành tính|ác tính|huyết áp|nội soi|xét nghiệm|mm|cm)\b',
    re.I | re.U,
)


def _is_repetitive(text: str, threshold: float = 0.6) -> bool:
    words = text.lower().split()
    if len(words) < 6:
        return False
    unique = len(set(words))
    return unique / len(words) < (1 - threshold)


def _confidence_score(corrections: list[str], flags: list[str], blocked_terms: list[str]) -> float:
    if any('dấu tiếng Việt' in f or 'Lặp từ' in f for f in flags):
        return 0.40
    if not corrections and not blocked_terms:
        return 0.96
    penalty = min(0.05 * len(corrections) + 0.06 * len(blocked_terms), 0.35)
    return round(max(0.60, 0.96 - penalty), 2)


# ---------------------------------------------------------------------------
# 6. Public API
# ---------------------------------------------------------------------------

def postprocess(text: str) -> dict:
    """Normalize medical terms, lock/strip non-medical fillers, and assess quality."""
    if not text or not text.strip():
        return {
            'text': text or '',
            'corrections': [],
            'blocked_terms': [],
            'flags': ['Đoạn trống hoặc chỉ có khoảng trắng.'],
            'confidence': 0.0,
            'accent_region': None,
            'medical_terms_matched': 0,
        }

    corrections: list[str] = []
    blocked_terms: list[str] = []
    flags: list[str] = []

    # -- Step 0: Lock & remove non-medical fillers / Whisper hallucinations
    for pattern, reason in _NON_MEDICAL_LOCK_PATTERNS:
        def _strip_locked(m: re.Match, rsn: str = reason) -> str:
            snippet = m.group(0).strip()
            if snippet:
                blocked_terms.append(f"{rsn}: '{snippet}'")
                corrections.append(f"Khóa/Xóa ({rsn}): '{snippet}'")
            return ' '
        text = pattern.sub(_strip_locked, text)

    text = re.sub(r'\s{2,}', ' ', text).strip()

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

    # -- Step 3: regional accent rules
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

    # -- Step 4: medical term corrections (Khoa Vú + general medicine)
    for pattern, replacement in _TERM_CORRECTIONS:
        text = pattern.sub(lambda m, r=replacement: _sub_and_log(m, r, corrections), text)

    # -- Step 5: quality flags
    if blocked_terms:
        flags.append(f"Đã khóa/loại {len(blocked_terms)} cụm từ không chuẩn y khoa.")
    if not _HAS_VI_DIACRITIC.search(text) and len(text) > 10:
        flags.append('Không có dấu tiếng Việt: có thể ghi âm bị nhiễu hoặc model nhầm ngôn ngữ. Soát lại.')
    if _is_repetitive(text):
        flags.append('Lặp từ bất thường: có thể là ảo giác (hallucination) của model. Soát kỹ hoặc yêu cầu đọc lại.')

    medical_terms_matched = len(_MEDICAL_STANDARD_TERMS.findall(text))
    confidence = _confidence_score(corrections, flags, blocked_terms)

    return {
        'text': text.strip(),
        'corrections': corrections,
        'blocked_terms': blocked_terms,
        'flags': flags,
        'confidence': confidence,
        'accent_region': accent_region,
        'medical_terms_matched': medical_terms_matched,
    }


def _sub_and_log(m: re.Match, replacement, log: list[str]) -> str:
    """Apply substitution (string or callable) and append to log."""
    result = replacement(m) if callable(replacement) else m.re.sub(replacement, m.group(0))
    if result != m.group(0):
        log.append(f"Thuật ngữ: '{m.group(0)}' → '{result}'")
    return result
