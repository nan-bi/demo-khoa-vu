import {isBackend,backendState,loadWorkspace,saveWorkspace} from '../backend/client.mjs';
import {readWorkspaceIdb,writeWorkspaceIdb} from './workspaceIdb.mjs';
export const REPORT_KEY='vinmec-demo-v1';

export function validateWorkspaceState(s){
 if(s?.version!==1||!Array.isArray(s.rows)||!Array.isArray(s.excluded)||!Array.isArray(s.logs)||!Array.isArray(s.imports)||!Array.isArray(s.hashes)||s.rows.some(r=>!r||typeof r!=='object')||(s.report&&(!['draft','submitted','approved'].includes(s.report.status)||!Array.isArray(s.report.stats?.table))))throw Error('Dữ liệu báo cáo lưu có lỗi; giữ nguyên để kiểm tra, không tự thay bằng dữ liệu mẫu.');
 const revision=s.revision??0;
 if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw Error('Phiên bản cập nhật báo cáo không hợp lệ.');
 return {...s,revision};
}

function readLocalRaw(storage){
 const raw=storage.getItem(REPORT_KEY);if(raw==null)return null;
 const parsed=JSON.parse(raw);
 if(parsed?.idbMirror)return {idbMirror:true,revision:parsed.revision??0};
 return validateWorkspaceState(parsed);
}

function tryWriteLocal(storage,next){
 try{storage.setItem(REPORT_KEY,JSON.stringify(next));return true;}
 catch(e){
  if(e?.name==='QuotaExceededError'||e?.code===22){
   try{storage.setItem(REPORT_KEY,JSON.stringify({idbMirror:true,revision:next.revision}));}catch{}
   return false;
  }
  throw e;
 }
}

export function readReport(storage=localStorage){
 if(isBackend())return backendState();
 const local=readLocalRaw(storage);
 if(local?.idbMirror)return null;
 return local;
}

export function transactReport(storage,expected,fn){
 const current=readReport(storage);if(!current||current.revision!==expected)throw Error('Báo cáo đã thay đổi ở tab khác hoặc đã bị xóa. Kiểm tra dữ liệu mới trước khi thao tác lại.');
 const next=fn(structuredClone(current));next.revision=current.revision+1;
 const raw=JSON.stringify(next);validateWorkspaceState(JSON.parse(raw));storage.setItem(REPORT_KEY,raw);return next;
}

async function lock(fn){if(!navigator.locks?.request)throw Error('Dùng Chrome/Edge mới trên localhost để bảo đảm khóa ghi báo cáo.');return navigator.locks.request('vinmec-report-write',fn);}

export const initializeReport=base=>isBackend()?loadWorkspace():lock(async()=>{
 const local=readLocalRaw(localStorage);
 if(local&&!local.idbMirror){await writeWorkspaceIdb(local).catch(()=>{});return local;}
 const idb=await readWorkspaceIdb().catch(()=>null);
 if(idb){const valid=validateWorkspaceState(idb);tryWriteLocal(localStorage,valid);return valid;}
 const s={...base,revision:0};
 await writeWorkspaceIdb(s).catch(()=>{});
 tryWriteLocal(localStorage,s);
 return s;
});

export const saveReport=(expected,fn)=>isBackend()?saveWorkspace(expected,fn):lock(async()=>{
 const local=readLocalRaw(localStorage);
 const current=(local&&!local.idbMirror)?local:validateWorkspaceState(await readWorkspaceIdb());
 if(!current||current.revision!==expected)throw Error('Báo cáo đã thay đổi ở tab khác hoặc đã bị xóa. Kiểm tra dữ liệu mới trước khi thao tác lại.');
 const next=fn(structuredClone(current));next.revision=current.revision+1;
 validateWorkspaceState(next);
 await writeWorkspaceIdb(next);
 tryWriteLocal(localStorage,next);
 return next;
});
