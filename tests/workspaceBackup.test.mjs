import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkspaceState} from '../src/features/reports/reportStore.mjs';
import {BACKUP_FORMAT,createBackupPayload,parseBackupPayload,applyBackupToWorkspace} from '../src/features/reports/workspaceBackup.mjs';

function sampleWorkspace(){
 return {
  version:1,
  revision:3,
  rows:[{order_id:'O-1',service_code:'SA-01',completed_at:'2026-11-19T08:00:00Z'}],
  imports:[{name:'DATA_THANG11.xlsx',count:1,date:'19/11/2026'}],
  hashes:['abc123'],
  excluded:[],
  report:null,
  serviceCalculation:{routingExamples:[{ordering_dept:'Khoa A',performing_dept:'VU',label:'VU_INBOUND',reason:'Đã đối chiếu'}]},
  logs:[{time:'19/11/2026',action:'Nhập 1 file'}],
 };
}

test('createBackupPayload and parseBackupPayload round-trip full workspace state',()=>{
 const ws=sampleWorkspace();
 const payload=createBackupPayload(ws,{version:1,revision:2,items:{k1:{label:'VU_INTERNAL'}}});
 assert.equal(payload.format,BACKUP_FORMAT);
 assert.equal(payload.summary.rows,1);
 assert.equal(payload.summary.imports,1);
 assert.equal(payload.summary.routingExamples,1);

 const parsed=parseBackupPayload(JSON.stringify(payload));
 assert.equal(parsed.workspace.rows.length,1);
 assert.equal(parsed.workspace.imports[0].name,'DATA_THANG11.xlsx');
 assert.equal(parsed.reviews.items.k1.label,'VU_INTERNAL');
});

test('parseBackupPayload rejects invalid JSON or foreign backup format',()=>{
 assert.throws(()=>parseBackupPayload('{bad json'),{name:'Error'});
 assert.throws(()=>parseBackupPayload(JSON.stringify({format:'other',workspace:{}})),/Khoa Vú/);
 assert.throws(()=>validateWorkspaceState({version:2,rows:[]}),/lỗi/);
});

test('applyBackupToWorkspace preserves current revision and logs restoration',()=>{
 const current={version:1,revision:7,rows:[],imports:[],hashes:[],excluded:[],logs:[]};
 const restored=applyBackupToWorkspace(current,sampleWorkspace());
 assert.equal(restored.revision,7);
 assert.equal(restored.rows.length,1);
 assert.equal(restored.imports.length,1);
 assert.match(restored.logs[0].action,/Khôi phục toàn bộ kho dữ liệu/);
});
