import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {completedRecord,reviewedRecord,hasDraftContent,draftSnapshot} from '../src/features/speech/records.mjs';
import {deviceStamp} from '../src/features/speech/clock.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
function id(value){if(typeof value!=='string'||!value.trim()||value.length>200)fail(400,'Mã ca/bản nháp không hợp lệ.');return value;}
function stamp(value){if(!value||typeof value.iso!=='string'||!Number.isFinite(Date.parse(value.iso)))fail(400,'Mốc thời gian không hợp lệ.');}
function state(value){
 if(!value||typeof value.transcript!=='string'||value.transcript.length>500000||!value.patient||!Array.isArray(value.events)||value.events.length>10000)fail(400,'Nội dung ca không hợp lệ.');
 for(const key of ['pid','visit','order','name','doctor','room'])if(typeof value.patient[key]!=='string'||value.patient[key].length>2000)fail(400,'Thông tin ca không hợp lệ.');
 for(const event of value.events)if(!event||typeof event.text!=='string'||event.text.length>500000)fail(400,'Lời nhận dạng không hợp lệ.');
 if(value.startedAt)stamp(value.startedAt);
 return value;
}
function record(value){
 state(value);id(value.id);stamp(value.startedAt);stamp(value.completedAt);
 if(!Number.isSafeInteger(value.revision)||value.revision<1||!['pending','reviewed'].includes(value.status)||typeof value.originalTranscript!=='string')fail(400,'Kết quả không hợp lệ.');
 if(value.status==='reviewed'&&(!value.review||typeof value.review.doctor!=='string'||!value.review.doctor.trim()))fail(400,'Thiếu người kiểm tra.');
 if(value.review)stamp(value.review.at);
 // Validate identity and required text even on legacy migration.
 try{completedRecord({...value,savedId:null},value.id,value.completedAt);}catch(e){fail(400,e.message);}
 return value;
}
function draft(value){id(value.id);id(value.owner);state(value.state);stamp(value.updatedAt);if(value.state.savedId)fail(400,'Bản nháp đã hoàn thành.');return value;}
export function openSpeechStore(filename){
 mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
 const db=new DatabaseSync(filename);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=FAST; CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,time TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_events_time ON events(time DESC);');
 const get=(table,key)=>{const row=db.prepare('SELECT payload FROM '+table+' WHERE id=?').get(key);return row?JSON.parse(row.payload):null;};
 const list=table=>db.prepare('SELECT payload FROM '+table).all().map(row=>JSON.parse(row.payload));
 function put(table,value){db.prepare('INSERT INTO '+table+'(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.id,JSON.stringify(value));}
 function tx(actor,action,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.prepare('INSERT INTO events(time,actor,action) VALUES(?,?,?)').run(new Date().toISOString(),actor,action);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 return {
  run(operation,b={},actor='internal'){
   if(operation==='results')return list('results').sort((a,b)=>b.completedAt.iso.localeCompare(a.completedAt.iso));
   if(operation==='drafts')return list('drafts').filter(d=>hasDraftContent(d.state)).sort((a,b)=>b.updatedAt.iso.localeCompare(a.updatedAt.iso));
   return tx(actor,operation,()=>{
    if(operation==='save-draft'){
     const identity=b.identity||{};id(identity.id);id(identity.owner);state(b.state);
     const current=get('drafts',identity.id);
     if(get('results',identity.id))fail(409,'Ca đã hoàn thành; không ghi lại bản nháp.');
     if(!current&&identity.claimed)fail(409,'Bản nháp không còn. Tải lại Kết quả hoặc khôi phục bản nháp.');
     if(current&&current.owner!==identity.owner)fail(409,'Bản nháp đã được mở ở tab khác.');
     const next=draft({id:identity.id,owner:identity.owner,state:draftSnapshot(b.state),updatedAt:deviceStamp()});put('drafts',next);return next;
    }
    if(operation==='restore-draft'){
     id(b.id);id(b.owner);const current=get('drafts',b.id);if(!current)fail(404,'Bản nháp không còn. Tải lại danh sách.');
     const next={...current,owner:b.owner};put('drafts',next);return next;
    }
    if(operation==='complete'){
     const value=record(b.record);const identity=b.draft;
     if(get('results',value.id))fail(409,'Ca đã được lưu. Tải lại Kết quả.');
     if(value.status!=='pending'||value.revision!==1||value.review!==null)fail(400,'Ca mới phải chờ bác sĩ kiểm tra.');
     if(!identity||identity.id!==value.id)fail(400,'Thiếu bản nháp nguồn của ca.');
     const current=get('drafts',id(identity.id));if(!current||current.owner!==identity.owner)fail(409,'Bản nháp đã mở ở tab khác hoặc chưa lưu xong.');
     const expected=completedRecord(current.state,value.id,value.completedAt);
     if(!isDeepStrictEqual(expected,value))fail(409,'Kết quả không khớp bản nháp đã lưu. Lưu bản nháp rồi thử lại.');
     put('results',expected);db.prepare('DELETE FROM drafts WHERE id=?').run(value.id);return expected;
    }
    if(operation==='review'){
     const current=get('results',id(b.id));if(!current||current.revision!==b.revision)fail(409,'Kết quả đã thay đổi. Tải lại danh sách.');
     if(!b.review||typeof b.review.doctor!=='string'||typeof b.review.transcript!=='string'||b.review.transcript.length>500000)fail(400,'Thông tin kiểm tra không hợp lệ.');
     let next;try{next=reviewedRecord(current,b.review);}catch(e){fail(409,e.message);}put('results',next);return next;
    }
    if(operation==='migrate'){
     if(!Array.isArray(b.results)||!Array.isArray(b.drafts)||b.results.length+b.drafts.length>10000)fail(400,'Dữ liệu chuyển kho không hợp lệ.');
     const seen=new Set();
     for(const [table,items,validate] of [['results',b.results,record],['drafts',b.drafts,draft]])for(const item of items){
      validate(item);const key=table+':'+item.id;if(seen.has(key))fail(400,'Trùng ca trong dữ liệu chuyển kho.');seen.add(key);
      const existing=get(table,item.id);
      if(existing&&!isDeepStrictEqual(existing,item))fail(409,'Ca trùng mã nhưng khác nội dung. Giữ nguyên dữ liệu trình duyệt để đối soát.');
      if(get(table==='results'?'drafts':'results',item.id))fail(409,'Ca trùng mã giữa bản nháp và kết quả. Cần đối soát.');
      put(table,item);
     }
     // Echo only after transaction succeeds; client verifies before clearing legacy data.
     return {results:b.results,drafts:b.drafts};
    }
    fail(404,'Không có thao tác lưu ca này.');
   });
  },close(){db.close();}
 };
}
