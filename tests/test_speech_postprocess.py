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

    def test_southern_accent_rules_and_confidence(self):
        r = postprocess("Xiêu âm bú phải thấy u sơ và nhủ hoa bình thường.")
        self.assertIn('siêu âm', r['text'])
        self.assertIn('vú phải', r['text'])
        self.assertIn('u xơ', r['text'])
        self.assertIn('nhũ hoa', r['text'])
        self.assertEqual(r['accent_region'], 'Nam')
        self.assertLess(r['confidence'], 0.95)
        self.assertTrue(any('Miền Nam' in f for f in r['flags']))

    def test_central_and_northern_accent_rules(self):
        r_central = postprocess("Siêu ôm phát hiện bưu nhỏ và năng nước.")
        self.assertIn('siêu âm', r_central['text'])
        self.assertIn('bướu', r_central['text'])
        self.assertIn('nang nước', r_central['text'])
        self.assertEqual(r_central['accent_region'], 'Trung')

        r_north = postprocess("Dải phẫu bệnh u dú kết quả birát 3.")
        self.assertIn('giải phẫu', r_north['text'])
        self.assertIn('u vú', r_north['text'])
        self.assertIn('BI-RADS', r_north['text'])
        self.assertEqual(r_north['accent_region'], 'Bắc')

    def test_real_voice_medical_terms_and_filler_locking(self):
        r = postprocess("Em ghi tiếp nhé, tuyến vũ cháy có khối nhôm mô, cốp bô bình thường, bi đắt một. Hãy subscribe kênh.")
        self.assertNotIn('Em ghi tiếp nhé', r['text'])
        self.assertNotIn('subscribe', r['text'])
        self.assertIn('tuyến vú trái', r['text'])
        self.assertIn('nhu mô', r['text'])
        self.assertIn('Cooper', r['text'])
        self.assertIn('BI-RADS 1', r['text'])
        self.assertGreaterEqual(len(r['blocked_terms']), 2)
        self.assertGreater(r['medical_terms_matched'], 0)

    def test_preserves_clinical_negation(self):
        r = postprocess("Tuyến vú phải không thấy khối bất thường, không thấy hạch.")
        self.assertIn('không thấy khối', r['text'])
        self.assertIn('không thấy hạch', r['text'])
        self.assertEqual(r['blocked_terms'], [])


if __name__ == '__main__':
    unittest.main()
