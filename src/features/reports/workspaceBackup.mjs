import {validateWorkspaceState} from './reportStore.mjs';
export const BACKUP_FORMAT='vinmec-khoavu-backup-v1';

export function createBackupPayload(workspace,reviews=null){
 validateWorkspaceState(workspace);
 return {
  format:BACKUP_FORMAT,
  exportedAt:new Date().toISOString(),
  summary:{
   rows:workspace.rows.length,
   imports:workspace.imports.length,
   routingExamples:workspace.serviceCalculation?.routingExamples?.length||0,
   archivedReports:workspace.archivedReports?.length||0,
  },
  workspace,
  reviews:reviews&&typeof reviews==='object'?reviews:null,
 };
}

export function parseBackupPayload(rawText){
 let data;
 try{data=JSON.parse(rawText);}catch{throw Error('Tệp sao lưu không phải JSON hợp lệ.');}
 if(!data||data.format!==BACKUP_FORMAT||!data.workspace)throw Error('Định dạng tệp sao lưu không đúng chuẩn Khoa Vú.');
 const workspace=validateWorkspaceState(data.workspace);
 return {format:data.format,exportedAt:data.exportedAt||null,workspace,reviews:data.reviews||null};
}

export function applyBackupToWorkspace(currentState,backupWorkspace){
 const clean=validateWorkspaceState(backupWorkspace);
 return {
  ...clean,
  version:1,
  revision:currentState?.revision??0,
  logs:[
   {time:new Date().toLocaleString('vi-VN'),action:`Khôi phục toàn bộ kho dữ liệu từ bản sao lưu (${clean.rows.length} dòng, ${clean.imports.length} lần nhập).`},
   ...(clean.logs||[]).slice(0,199),
  ],
 };
}
