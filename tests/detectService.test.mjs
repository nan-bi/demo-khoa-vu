import test from 'node:test';
import assert from 'node:assert/strict';
import {detectServiceFromSpeech,SERVICE_SPEECH_LABELS,SERVICE_SPEECH_PATTERNS} from '../src/features/intelligence/revenueAI.mjs';

const SINGLE_SERVICE_CASES=[
 ['Siêu âm vú phải.','SIÊU_ÂM'],
 ['siêu am vú trái','SIÊU_ÂM'],
 ['Doppler vi mạch tổn thương','SIÊU_ÂM'],
 ['X-quang vú 2D bình thường','XQ_VÚ'],
 ['Mammography không phát hiện bất thường','XQ_VÚ'],
 ['xquang vú','XQ_VÚ'],
 ['MRI vú 1.5 Tesla','CĐHA_CAO_CẤP'],
 ['cộng hưởng từ vú','CĐHA_CAO_CẤP'],
 ['CT scan tuyến vú','CĐHA_CAO_CẤP'],
 ['Sinh thiết lõi vú phải','CAN_THIỆP_TIỂU_PHẪU'],
 ['Chọc hút tế bào u nang','CAN_THIỆP_TIỂU_PHẪU'],
 ['Định vị tổn thương trước mổ','CAN_THIỆP_TIỂU_PHẪU'],
 ['FNAC vú phải','CAN_THIỆP_TIỂU_PHẪU'],
 ['Khám vú định kỳ','KHÁM'],
 ['Khám lâm sàng không phát hiện bất thường','KHÁM'],
 ['Giải phẫu bệnh lành tính','GIẢI_PHẪU_BỆNH_GEN'],
 ['Xét nghiệm gene BRCA1 âm tính','GIẢI_PHẪU_BỆNH_GEN'],
 ['IHC marker ung thư dương tính','GIẢI_PHẪU_BỆNH_GEN'],
 ['Phẫu thuật cắt bỏ u xơ lành tính','PHẪU_THUẬT'],
 ['Tạo hình vú sau điều trị','PHẪU_THUẬT'],
 ['Mổ vú phải hôm nay','PHẪU_THUẬT'],
];

test('detectServiceFromSpeech detects individual service groups',()=>{
 for(const [text,expected] of SINGLE_SERVICE_CASES){
  assert.ok(detectServiceFromSpeech(text).includes(expected),`Expected ${expected} for: ${text}`);
 }
});

test('detectServiceFromSpeech detects multiple services in one sentence',()=>{
 const result=detectServiceFromSpeech('Siêu âm vú phải, x-quang 2D và sinh thiết lõi hướng dẫn siêu âm.');
 assert.deepEqual(result,['SIÊU_ÂM','XQ_VÚ','CAN_THIỆP_TIỂU_PHẪU']);
});

test('detectServiceFromSpeech returns empty for blank, non-string, or unmatched text',()=>{
 for(const input of ['','   ',null,undefined,'Bệnh nhân ổn định, không có bất thường.']){
  assert.deepEqual(detectServiceFromSpeech(input),[]);
 }
});

test('SERVICE_SPEECH_LABELS covers all pattern keys',()=>{
 for(const code of Object.keys(SERVICE_SPEECH_PATTERNS)){
  assert.ok(Object.hasOwn(SERVICE_SPEECH_LABELS,code),`Missing label for ${code}`);
 }
});
