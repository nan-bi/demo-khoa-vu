// Offline multinomial Naive Bayes. Only department text is a feature.
// Money, patient identities, filenames and clinical findings never enter training.
import {department,ROUTES} from './routing.mjs';
export const AI_VERSION='VU-REVENUE-NB-1';
export const CONFIDENCE_THRESHOLD=0.75;
export const normalizeDept=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toUpperCase().trim().replace(/\s+/g,' ');
const names={'KHOA VU':'VU','CHUYEN KHOA VU':'VU','KHOA CHAN DOAN HINH ANH':'CDHA','TRUNG TAM CHAN DOAN HINH ANH':'CDHA','KHOA XET NGHIEM':'XETNGHIEM','TRUNG TAM XET NGHIEM':'XETNGHIEM','KHOA SUC KHOE TONG QUAT':'KSKTQ','SUC KHOE TONG QUAT':'KSKTQ','KHOA UNG BUOU':'UNGBUOU'};
export const resolveDept=v=>department(v)||names[normalizeDept(v)]||null;
export const pairKey=r=>JSON.stringify([normalizeDept(r.ordering_dept),normalizeDept(r.performing_dept)]);
const route=(a,b)=>!a||!b?null:a==='VU'?(b==='VU'?'VU_INTERNAL':'VU_OUTBOUND'):b==='VU'?'VU_INBOUND':'EXTERNAL_UNRELATED';
const tokens=r=>[...Array(8).fill('pair='+pairKey(r)),...['ordering_dept','performing_dept'].flatMap(k=>{const v=normalizeDept(r[k]);return [k+'='+v,...v.split(/[^A-Z0-9]+/).filter(Boolean).map(t=>k+':'+t)];})];

// ---------------------------------------------------------------------------
// Speech-to-service classification: detect which medical service group was
// spoken about in a dictation transcript. Used to auto-categorise revenue.
// Rules are deterministic keyword sets—no AI guessing, no network calls.
// ---------------------------------------------------------------------------
export const SERVICE_SPEECH_PATTERNS = {
 'SIÊU_ÂM': [/siêu\s+âm/i,/siêu\s+am\b/i,/doppler/i,/dóp\s*ple/i,/dóp\s*pơ/i,/elastography/i,/vi\s+mạch/i],
 'XQ_VÚ':   [/x[\s-]quang/i,/mammograph/i,/mammogram/i,/nhũ\s+ảnh/i,/xquang/i],
 'CĐHA_CAO_CẤP':[/mri/i,/cộng\s+hưởng\s+từ/i,/ct\s+scan/i,/chụp\s+cắt\s+lớp/i,/pet[\s-]ct/i,/phổ\s+hồng\s+ngoại/i],
 'CAN_THIỆP_TIỂU_PHẪU':[/sinh\s+thiế[ct]/i,/can\s+thiệp/i,/chọc\s+hút/i,/fnac/i,/core\s+biopsy/i,/định\s+vị/i,/cắt\s+lọc/i],
 'KHÁM':    [/khám\s+vú/i,/thăm\s+khám/i,/khám\s+lâm\s+sàng/i,/khám\s+định\s+kỳ/i,/khám\s+tổng\s+quát/i],
 'GIẢI_PHẪU_BỆNH_GEN':[/giải\s+phẫu\s+bệnh/i,/mô\s+bệnh\s+học/i,/xét\s+nghiệm\s+di\s+truyền/i,/brca/i,/gene[\s-]xpert/i,/immunohistochem/i,/ihc\b/i,/marker\s+ung\s+thư/i],
 'PHẪU_THUẬT':[/phẫu\s+thuật/i,/mổ\s+vú/i,/cắt\s+bỏ/i,/tạo\s+hình/i,/đặt\s+túi\s+ngực/i,/implant/i,/sentinel\s+node/i,/hạch\s+gác/i],
};

/**
 * Detect service group(s) mentioned in a speech transcript.
 * Returns array of matched group codes (may be empty; never guesses).
 * Does NOT classify revenue rows—this is for display hints only.
 */
export function detectServiceFromSpeech(text=''){
 if(typeof text!=='string'||!text.trim())return [];
 return Object.entries(SERVICE_SPEECH_PATTERNS)
  .filter(([,patterns])=>patterns.some(p=>p.test(text)))
  .map(([code])=>code);
}

/**
 * Map service group code to a human-readable label (Vietnamese).
 */
export const SERVICE_SPEECH_LABELS={
 'SIÊU_ÂM':'Siêu âm vú',
 'XQ_VÚ':'X-quang vú',
 'CĐHA_CAO_CẤP':'Chẩn đoán hình ảnh cao cấp (MRI/CT)',
 'CAN_THIỆP_TIỂU_PHẪU':'Can thiệp / tiểu phẫu',
 'KHÁM':'Khám vú',
 'GIẢI_PHẪU_BỆNH_GEN':'Giải phẫu bệnh / di truyền',
 'PHẪU_THUẬT':'Phẫu thuật vú',
};
export function validateLearning(examples=[]){
 if(!Array.isArray(examples)||examples.length>2000)throw Error('Tối đa 2.000 cặp khoa đã xác nhận.');
 const seen=new Set();for(const e of examples){
  if(!e||typeof e.ordering_dept!=='string'||!e.ordering_dept.trim()||e.ordering_dept.length>200||typeof e.performing_dept!=='string'||!e.performing_dept.trim()||e.performing_dept.length>200||!ROUTES.includes(e.label)||typeof e.reason!=='string'||e.reason.trim().length<8)throw Error('Nhãn học cần đủ hai khoa, phân loại và lý do ít nhất 8 ký tự.');
  const a=resolveDept(e.ordering_dept),b=resolveDept(e.performing_dept),known=route(a,b);
  if((known&&known!==e.label)||(a==='VU'&&!['VU_INTERNAL','VU_OUTBOUND'].includes(e.label))||(a&&a!=='VU'&&['VU_INTERNAL','VU_OUTBOUND'].includes(e.label))||(b==='VU'&&!['VU_INTERNAL','VU_INBOUND'].includes(e.label))||(b&&b!=='VU'&&['VU_INTERNAL','VU_INBOUND'].includes(e.label)))throw Error('Nhãn mâu thuẫn khoa đã nhận diện. Sửa dữ liệu nguồn trước.');
  if(seen.has(pairKey(e)))throw Error('Cặp khoa có nhiều nhãn; cần đối soát.');seen.add(pairKey(e));
 }
}
export function trainRevenueModel(examples=[]){
 validateLearning(examples);
 const base=['VU','CDHA','KSKTQ','XETNGHIEM','GAYME','UNGBUOU','GPB','NOI'].flatMap(a=>['VU','CDHA','KSKTQ','XETNGHIEM','GAYME','UNGBUOU','GPB','NOI'].map(b=>({ordering_dept:a,performing_dept:b,label:route(a,b)})));
 const model={version:AI_VERSION,documents:{},counts:{},totals:{},vocabulary:new Set(),examples:new Map(examples.map(e=>[pairKey(e),e]))};
 for(const label of ROUTES){model.documents[label]=0;model.counts[label]=new Map();model.totals[label]=0;}
 for(const e of [...base,...examples]){model.documents[e.label]++;for(const t of tokens(e)){model.vocabulary.add(t);model.counts[e.label].set(t,(model.counts[e.label].get(t)||0)+1);model.totals[e.label]++;}}
 model.trainingCount=base.length+examples.length;model.reviewedCount=examples.length;return model;
}
export function predictRevenue(row,model){
 const scores=ROUTES.map(label=>({label,score:Math.log((model.documents[label]+1)/(model.trainingCount+ROUTES.length))+tokens(row).filter(t=>model.vocabulary.has(t)).reduce((n,t)=>n+Math.log(((model.counts[label].get(t)||0)+1)/(model.totals[label]+model.vocabulary.size)),0)})).sort((a,b)=>b.score-a.score);
 const denominator=scores.reduce((n,x)=>n+Math.exp(x.score-scores[0].score),0);
 const a=resolveDept(row.ordering_dept),b=resolveDept(row.performing_dept),known=route(a,b),review=model.examples.get(pairKey(row)),label=known||review?.label||null,score=1/denominator,source=known?'Danh mục khoa chuẩn':review?'Cặp khoa đã xác nhận':'AI gợi ý · cần xác nhận',needs_review=!label||(source.startsWith('AI')&&score<CONFIDENCE_THRESHOLD);
 return {label,suggestion:scores[0].label,score,confidence:score,needs_review,source,included:['VU_INTERNAL','VU_OUTBOUND'].includes(label),pending:!label,version:AI_VERSION};
}
export function revenueScope(rows,config={}){
 const model=trainRevenueModel(config.routingExamples||[]),records=rows.map(row=>({row,...predictRevenue(row,model)}));
 return {model,records,included:records.filter(r=>r.included).map(r=>r.row),pending:records.filter(r=>r.pending),needsReview:records.filter(r=>r.needs_review),excluded:records.filter(r=>!r.pending&&!r.included)};
}
