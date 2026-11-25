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


if __name__ == '__main__':
    unittest.main()
