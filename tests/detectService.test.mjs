import test from 'node:test';
import assert from 'node:assert/strict';
import {detectServiceFromSpeech,SERVICE_SPEECH_LABELS,SERVICE_SPEECH_PATTERNS} from '../src/features/intelligence/revenueAI.mjs';

test('detectServiceFromSpeech: siêu âm variants',()=>{
 assert.deepEqual(detectServiceFromSpeech('Siêu âm vú phải.'),['SIÊU_ÂM']);
 assert.deepEqual(detectServiceFromSpeech('siêu am vú trái'),['SIÊU_ÂM']);
 assert.ok(detectServiceFromSpeech('Doppler vi mạch tổn thương').includes('SIÊU_ÂM'));
});
test('detectServiceFromSpeech: x-quang variants',()=>{
 assert.ok(detectServiceFromSpeech('X-quang vú 2D bình thường').includes('XQ_VÚ'));
 assert.ok(detectServiceFromSpeech('Mammography không phát hiện bất thường').includes('XQ_VÚ'));
 assert.ok(detectServiceFromSpeech('xquang vú').includes('XQ_VÚ'));
});
test('detectServiceFromSpeech: MRI and CT',()=>{
 assert.ok(detectServiceFromSpeech('MRI vú 1.5 Tesla').includes('CĐHA_CAO_CẤP'));
 assert.ok(detectServiceFromSpeech('cộng hưởng từ vú').includes('CĐHA_CAO_CẤP'));
 assert.ok(detectServiceFromSpeech('CT scan tuyến vú').includes('CĐHA_CAO_CẤP'));
});
test('detectServiceFromSpeech: sinh thiết and can thiệp',()=>{
 assert.ok(detectServiceFromSpeech('Sinh thiết lõi vú phải').includes('CAN_THIỆP_TIỂU_PHẪU'));
 assert.ok(detectServiceFromSpeech('Chọc hút tế bào u nang').includes('CAN_THIỆP_TIỂU_PHẪU'));
 assert.ok(detectServiceFromSpeech('Định vị tổn thương trước mổ').includes('CAN_THIỆP_TIỂU_PHẪU'));
 assert.ok(detectServiceFromSpeech('FNAC vú phải').includes('CAN_THIỆP_TIỂU_PHẪU'));
});
test('detectServiceFromSpeech: khám vú',()=>{
 assert.ok(detectServiceFromSpeech('Khám vú định kỳ').includes('KHÁM'));
 assert.ok(detectServiceFromSpeech('Khám lâm sàng không phát hiện bất thường').includes('KHÁM'));
});
test('detectServiceFromSpeech: giải phẫu bệnh and di truyền',()=>{
 assert.ok(detectServiceFromSpeech('Giải phẫu bệnh lành tính').includes('GIẢI_PHẪU_BỆNH_GEN'));
 assert.ok(detectServiceFromSpeech('Xét nghiệm gene BRCA1 âm tính').includes('GIẢI_PHẪU_BỆNH_GEN'));
 assert.ok(detectServiceFromSpeech('IHC marker ung thư dương tính').includes('GIẢI_PHẪU_BỆNH_GEN'));
});
test('detectServiceFromSpeech: phẫu thuật',()=>{
 assert.ok(detectServiceFromSpeech('Phẫu thuật cắt bỏ u xơ lành tính').includes('PHẪU_THUẬT'));
 assert.ok(detectServiceFromSpeech('Tạo hình vú sau điều trị').includes('PHẪU_THUẬT'));
 assert.ok(detectServiceFromSpeech('Mổ vú phải hôm nay').includes('PHẪU_THUẬT'));
});
test('detectServiceFromSpeech: multiple services in one sentence',()=>{
 const result=detectServiceFromSpeech('Siêu âm vú phải, x-quang 2D và sinh thiết lõi hướng dẫn siêu âm.');
 assert.ok(result.includes('SIÊU_ÂM'));
 assert.ok(result.includes('XQ_VÚ'));
 assert.ok(result.includes('CAN_THIỆP_TIỂU_PHẪU'));
});
test('detectServiceFromSpeech: empty and irrelevant text',()=>{
 assert.deepEqual(detectServiceFromSpeech(''),[]);
 assert.deepEqual(detectServiceFromSpeech('   '),[]);
 assert.deepEqual(detectServiceFromSpeech('Bệnh nhân ổn định, không có bất thường.'),[]);
});
test('detectServiceFromSpeech: returns empty for non-string',()=>{
 assert.deepEqual(detectServiceFromSpeech(null),[]);
 assert.deepEqual(detectServiceFromSpeech(undefined),[]);
});
test('SERVICE_SPEECH_LABELS covers all pattern keys',()=>{
 for(const code of Object.keys(SERVICE_SPEECH_PATTERNS)){
  assert.ok(Object.hasOwn(SERVICE_SPEECH_LABELS,code),`Missing label for ${code}`);
 }
});
