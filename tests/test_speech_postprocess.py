"""Unit tests for speech_postprocess.py — medical term normalization."""
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from speech_postprocess import postprocess

# We test the Python module directly since JS detectServiceFromSpeech is a separate unit.


class PostprocessTests(unittest.TestCase):

    def test_unit_alias_normalization(self):
        r = postprocess("Khối 12 mi li mét nhân 8 mi li mét tại vú phải.")
        self.assertIn('12 mm', r['text'])
        self.assertIn('8 mm', r['text'])
        self.assertTrue(any('Đơn vị' in c for c in r['corrections']))

    def test_unit_alias_centimeter(self):
        r = postprocess("Hạch 1 centi mét.")
        self.assertIn('1 cm', r['text'])

    def test_term_birads_correction(self):
        r = postprocess("Siêu âm vú phải bai rát 4.")
        self.assertIn('BI-RADS', r['text'])
        self.assertTrue(any('Thuật ngữ' in c for c in r['corrections']))

    def test_term_sinhtiet_correction(self):
        r = postprocess("Sinh tiệc lành tính.")
        self.assertIn('sinh thiết', r['text'])

    def test_term_giaiphau_correction(self):
        r = postprocess("Giai phẫu bệnh không phát hiện bất thường.")
        self.assertIn('giải phẫu', r['text'])

    def test_no_vi_diacritic_flag(self):
        r = postprocess("Khong phat hien bat thuong trong sieu am.")
        self.assertTrue(any('dấu tiếng Việt' in f for f in r['flags']))

    def test_repetitive_hallucination_flag(self):
        r = postprocess("vú vú vú vú vú vú vú vú vú vú.")
        self.assertTrue(any('Lặp từ' in f for f in r['flags']))

    def test_clean_text_no_corrections(self):
        r = postprocess("Siêu âm vú phải, không phát hiện khối.")
        self.assertEqual(r['corrections'], [])
        self.assertEqual(r['flags'], [])
        self.assertEqual(r['text'], "Siêu âm vú phải, không phát hiện khối.")

    def test_empty_text(self):
        r = postprocess("")
        self.assertEqual(r['text'], "")
        self.assertTrue(len(r['flags']) > 0)

    def test_none_text(self):
        r = postprocess(None)  # type: ignore
        self.assertTrue(len(r['flags']) > 0)

    def test_birads_variant_spellings(self):
        for variant in ["bai rát", "bai rat", "birát", "birat", "Bai Rát"]:
            r = postprocess(f"Siêu âm {variant} 3.")
            self.assertIn('BI-RADS', r['text'], msg=f"Failed for: {variant!r}")

    def test_siêu_am_typo(self):
        r = postprocess("siêu am vú trái bình thường.")
        self.assertIn('siêu âm', r['text'])

    def test_number_unit_in_mm(self):
        r = postprocess("Mười mili mét nhân ba mi li mét.")
        # number-word + mm not in scope, only digit + unit alias
        # but "milimet" should still be caught in pattern
        # This just confirms no crash.
        self.assertIsInstance(r['text'], str)

    def test_khoi_typo(self):
        r = postprocess("Phát hiện khôi kích thước nhỏ.")
        self.assertIn('khối', r['text'])


# Minimal Python mirror of JS detectServiceFromSpeech for testing the pattern logic.
import re as _re

_SERVICE_SPEECH_PATTERNS = {
    'SIÊU_ÂM': [_re.compile(r'siêu\s+âm', _re.I), _re.compile(r'siêu\s+am\b', _re.I),
                _re.compile(r'doppler', _re.I), _re.compile(r'dóp\s*ple', _re.I),
                _re.compile(r'vi\s+mạch', _re.I)],
    'XQ_VÚ':   [_re.compile(r'x[\s-]quang', _re.I), _re.compile(r'mammograph', _re.I),
                _re.compile(r'nhũ\s+ảnh', _re.I), _re.compile(r'xquang', _re.I)],
    'CAN_THIỆP_TIỂU_PHẪU': [_re.compile(r'sinh\s+thiế[ct]', _re.I), _re.compile(r'can\s+thiệp', _re.I),
                              _re.compile(r'chọc\s+hút', _re.I), _re.compile(r'fnac', _re.I),
                              _re.compile(r'định\s+vị', _re.I)],
    'KHÁM':    [_re.compile(r'khám\s+vú', _re.I), _re.compile(r'thăm\s+khám', _re.I),
                _re.compile(r'khám\s+lâm\s+sàng', _re.I)],
    'GIẢI_PHẪU_BỆNH_GEN': [_re.compile(r'giải\s+phẫu\s+bệnh', _re.I), _re.compile(r'brca', _re.I),
                             _re.compile(r'ihc\b', _re.I)],
    'PHẪU_THUẬT': [_re.compile(r'phẫu\s+thuật', _re.I), _re.compile(r'mổ\s+vú', _re.I),
                   _re.compile(r'tạo\s+hình', _re.I)],
    'CĐHA_CAO_CẤP': [_re.compile(r'mri', _re.I), _re.compile(r'cộng\s+hưởng\s+từ', _re.I),
                     _re.compile(r'ct\s+scan', _re.I)],
}


def detectServiceFromSpeech_py(text: str) -> list[str]:
    if not text or not text.strip():
        return []
    return [code for code, pats in _SERVICE_SPEECH_PATTERNS.items()
            if any(p.search(text) for p in pats)]


class DetectServiceTests(unittest.TestCase):

    def test_sieu_am(self):
        self.assertIn('SIÊU_ÂM', detectServiceFromSpeech_py("Siêu âm vú phải."))

    def test_xquang(self):
        self.assertIn('XQ_VÚ', detectServiceFromSpeech_py("X-quang vú 2D bình thường."))

    def test_sinh_thiet(self):
        self.assertIn('CAN_THIỆP_TIỂU_PHẪU', detectServiceFromSpeech_py("Thực hiện sinh thiết lõi."))

    def test_mri(self):
        self.assertIn('CĐHA_CAO_CẤP', detectServiceFromSpeech_py("MRI vú 1,5 Tesla."))

    def test_phau_thuat(self):
        self.assertIn('PHẪU_THUẬT', detectServiceFromSpeech_py("Phẫu thuật cắt bỏ u xơ."))

    def test_giai_phau_benh(self):
        self.assertIn('GIẢI_PHẪU_BỆNH_GEN', detectServiceFromSpeech_py("Kết quả giải phẫu bệnh lành tính."))

    def test_no_match(self):
        self.assertEqual(detectServiceFromSpeech_py("Bệnh nhân ổn định."), [])

    def test_multiple_services_in_one_sentence(self):
        matches = detectServiceFromSpeech_py("Siêu âm vú phải, x-quang 2D và sinh thiết lõi.")
        self.assertIn('SIÊU_ÂM', matches)
        self.assertIn('XQ_VÚ', matches)
        self.assertIn('CAN_THIỆP_TIỂU_PHẪU', matches)

    def test_empty_text(self):
        self.assertEqual(detectServiceFromSpeech_py(""), [])

    def test_doppler(self):
        self.assertIn('SIÊU_ÂM', detectServiceFromSpeech_py("Doppler vi mạch tổn thương vú."))

    def test_brca(self):
        self.assertIn('GIẢI_PHẪU_BỆNH_GEN', detectServiceFromSpeech_py("Xét nghiệm gene BRCA1."))


if __name__ == '__main__':
    unittest.main()
