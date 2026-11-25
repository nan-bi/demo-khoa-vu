import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createBackend} from '../backend/server.mjs';
import {createUser} from '../backend/auth.mjs';
import {openDatabase} from '../backend/database.mjs';
import {getWorkspace} from '../backend/workspace.mjs';
import {saveDataEdit} from '../src/features/dataWorkspace/dataModel.mjs';
import {saveCalculationConfig,DEFAULT_SERVICE_KINDS} from '../src/features/reports/serviceCalculation.mjs';
const seed=JSON.parse(await fs.readFile(new URL('../src/data/seed.json',import.meta.url),'utf8'));
const catalog=seed.DANH_MUC_DV.map(r=>({code:r['Mã dịch vụ mô phỏng'],name:r['Tên đơn vị dịch vụ mô phỏng'],group:r['Nhóm']}));
const initialState=()=>({version:1,revision:0,rows:[seed.CANONICAL.find(r=>r.status==='HOANTHANH'&&r.price_mode==='MUALE'&&r.discount_known===1)],excluded:[],imports:[],hashes:[],logs:[],report:null});
test('Internal backend authentication, persistence, authorization and report integrity',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'vinmec-backend-')),databasePath=path.join(folder,'test.sqlite');
 const app=await createBackend({databasePath,initialState:initialState(),catalog});
 for(const role of ['admin','editor','reviewer','viewer'])createUser(app.db,{username:role,password:'Internal-Test-Only-1234',role});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(route,{method='GET',body,auth,headers={}}={})=>{const res=await fetch(origin+route,{method,headers:{...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json(),headers:res.headers}};
 const login=async name=>{const r=await call('/api/auth/login',{method:'POST',body:{username:name,password:'Internal-Test-Only-1234'}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf}};
 let editor,reviewer,viewer,admin;
 try{
  await t.test('Unauthenticated clients cannot read data; sessions do not expose password hashes',async()=>{
   assert.equal((await call('/api/workspace')).status,401);editor=await login('editor');reviewer=await login('reviewer');viewer=await login('viewer');admin=await login('admin');
   const session=await call('/api/auth/session',{auth:editor});assert.equal(session.data.user.role,'editor');assert.ok(!JSON.stringify(session.data).includes('password_hash'));
   assert.equal((await call('/api/auth/login',{method:'POST',body:{username:'editor',password:'wrong'}})).status,401);
  });
  await t.test('Cross-origin and CSRF writes are denied; viewer cannot write or inspect admin users',async()=>{
   const state=(await call('/api/workspace',{auth:editor})).data;
   assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:0,state},headers:{Origin:'http://untrusted.invalid'}})).status,403);
   assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:0,state},headers:{'X-CSRF-Token':'wrong'}})).status,403);
   assert.equal((await call('/api/workspace',{method:'PUT',auth:viewer,body:{expectedRevision:0,state}})).status,403);
   assert.equal((await call('/api/admin/users',{auth:viewer})).status,403);
  });
  await t.test('Editor saves validated edits, server assigns audit identity and rejects stale versions',async()=>{
   const current=(await call('/api/workspace',{auth:editor})).data;
   const next=saveDataEdit(current,{index:0,patch:{unit_price_vnd:current.rows[0].unit_price_vnd+1000},reason:'Đối soát giá nguồn nội bộ',expectedRevision:0},catalog);
   const saved=await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:0,state:next}});assert.equal(saved.status,200);assert.equal(saved.data.revision,1);assert.equal(saved.data.dataEdits[0].actor,'editor');
   assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:0,state:next}})).status,409);
   const tampered=structuredClone(saved.data);tampered.rows[0].patient_id='WRONG-PATIENT';assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:1,state:tampered}})).status,400);
   assert.equal((await call('/api/workspace',{auth:editor})).data.revision,1);
  });
  await t.test('Tariffs persist by billing category and invalid tariffs are rejected',async()=>{
   let state=(await call('/api/workspace',{auth:editor})).data;
   const code=state.rows[0].service_code;
   state.serviceCalculation={packageTypes:{},serviceKinds:DEFAULT_SERVICE_KINDS,rates:{[code]:{RETAIL:-1}}};
   assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}})).status,400);
   state=(await call('/api/workspace',{auth:editor})).data;
   state=saveCalculationConfig(state,{packageTypes:{},serviceKinds:DEFAULT_SERVICE_KINDS,rates:{[code]:{RETAIL:600000,SKTQ:210000,SLUT1:310000,SLUT2:260000}}},'Nhập / đối soát','Khai báo giá theo từng nhóm');
   const saved=await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}});
   assert.equal(saved.status,200);assert.deepEqual(saved.data.serviceCalculation,state.serviceCalculation);
  });
  await t.test('Snapshot totals are calculated by server and frozen source cannot be edited',async()=>{
   let state=(await call('/api/workspace',{auth:editor})).data;
   state.report={id:'CLIENT-FAKE',status:'draft',week:'2026-04-01',end:'2026-11-01',stats:{gross:1}};
   const result=await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}});assert.equal(result.status,200);assert.notEqual(result.data.report.id,'CLIENT-FAKE');assert.notEqual(result.data.report.stats.gross,1);assert.equal(result.data.report.creator,'editor');
   assert.deepEqual(result.data.report.serviceRevenue.configuration,result.data.serviceCalculation);
   state=structuredClone(result.data);state.report.serviceRevenue.knownRevenue=1;
   assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}})).status,400);
   state=structuredClone(result.data);state.rows[0].unit_price_vnd++;
   assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}})).status,403);
   state=structuredClone(result.data);state.report.status='approved';assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}})).status,403);
  });
  await t.test('Review workflow requires reviewer; snapshots and archives are immutable',async()=>{
   let state=(await call('/api/workspace',{auth:editor})).data;state.report.status='submitted';let r=await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}});assert.equal(r.status,200);
   state=r.data;state.report.stats.gross=1;state.report.status='approved';assert.equal((await call('/api/workspace',{method:'PUT',auth:reviewer,body:{expectedRevision:state.revision,state}})).status,400);
   state=(await call('/api/workspace',{auth:reviewer})).data;state.report.status='approved';r=await call('/api/workspace',{method:'PUT',auth:reviewer,body:{expectedRevision:state.revision,state}});assert.equal(r.status,200);
   const approved=structuredClone(r.data.report);assert.equal((await call('/api/snapshots/'+approved.id,{auth:viewer})).data.stats.gross,approved.stats.gross);
   state=r.data;state.report.narrative='Tampered';assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}})).status,400);
   state=(await call('/api/workspace',{auth:editor})).data;state.archivedReports=[state.report];state.report=null;r=await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}});assert.equal(r.status,200);assert.deepEqual(r.data.archivedReports[0],approved);
   state=r.data;state.archivedReports[0].stats.gross=1;assert.equal((await call('/api/workspace',{method:'PUT',auth:editor,body:{expectedRevision:state.revision,state}})).status,400);
  });
  await t.test('Admin can create users and inspect persistent audit; logout revokes the session',async()=>{
   assert.equal((await call('/api/admin/users',{method:'POST',auth:editor,body:{username:'newuser',password:'Test-Password-1234',role:'admin'}})).status,403);
   const created=await call('/api/admin/users',{method:'POST',auth:admin,body:{username:'newuser',password:'Test-Password-1234',role:'viewer'}});assert.equal(created.status,201);assert.ok(!JSON.stringify(created.data).includes('password_hash'));
   const events=(await call('/api/admin/audit',{auth:admin})).data.events;assert.ok(events.some(e=>e.action==='WORKSPACE_UPDATED'&&e.username==='editor'));
   assert.equal((await call('/api/auth/logout',{method:'POST',auth:viewer,body:{}})).status,200);assert.equal((await call('/api/workspace',{auth:viewer})).status,401);
  });
  await t.test('Model review labels persist centrally, enforce role and revision, and record actual identity',async()=>{
   const value={label:'VU_INTERNAL',fingerprint:'test-source-fingerprint',reason:'Đối chiếu nguồn dữ liệu',reviewer:'FAKE-ACTOR',rulesVersion:'TEST',profile:'local-12'};
   assert.equal((await call('/api/reviews',{method:'PUT',auth:reviewer,body:{expectedRevision:0,key:'TEST-LABEL',value}})).status,403);
   const result=await call('/api/reviews',{method:'PUT',auth:editor,body:{expectedRevision:0,key:'TEST-LABEL',value}});assert.equal(result.status,200);assert.equal(result.data.items['TEST-LABEL'].reviewer,'editor');
   assert.equal((await call('/api/reviews',{method:'PUT',auth:editor,body:{expectedRevision:0,key:'TEST-LABEL',value}})).status,409);
   assert.equal((await call('/api/reviews',{auth:admin})).data.revision,1);
  });
  await t.test('Security hardening: HTTP headers, password strength, user lifecycle and rate limiting',async()=>{
   // 1. Security Headers
   const health=await call('/api/health');
   assert.match(health.headers.get('content-security-policy'),/default-src 'self'/);
   assert.equal(health.headers.get('x-frame-options'),'DENY');
   assert.equal(health.headers.get('referrer-policy'),'same-origin');
   assert.equal(health.headers.get('x-content-type-options'),'nosniff');
   assert.equal(health.headers.get('cross-origin-opener-policy'),'same-origin');
   assert.equal(health.headers.get('cross-origin-resource-policy'),'same-origin');
   assert.match(health.headers.get('permissions-policy'),/camera=\(\)/);

   // 2. Password Strength Validation
   assert.equal((await call('/api/admin/users',{method:'POST',auth:admin,body:{username:'weakuser',password:'weak',role:'viewer'}})).status,400);
   assert.equal((await call('/api/admin/users',{method:'POST',auth:admin,body:{username:'weakuser',password:'alllowercaseonly',role:'viewer'}})).status,400);

   // 3. User Lifecycle Management (Admin PATCH active/role & reset password)
   const testUserRes=await call('/api/admin/users',{method:'POST',auth:admin,body:{username:'lifecycle-user',password:'Internal-Test-Only-1234',role:'viewer'}});
   assert.equal(testUserRes.status,201);
   const testUserId=testUserRes.data.user.id;

   // Login with lifecycle-user
   const userSession=await login('lifecycle-user');
   assert.ok(userSession.csrf);

   // User changes own password
   const changeRes=await call('/api/auth/change-password',{method:'POST',auth:userSession,body:{oldPassword:'Internal-Test-Only-1234',newPassword:'Lifecycle-Pass-456'}});
   assert.equal(changeRes.status,200);

   // Old password fails, new password succeeds
   assert.equal((await call('/api/auth/login',{method:'POST',body:{username:'lifecycle-user',password:'Internal-Test-Only-1234'}})).status,401);
   const newSession=await call('/api/auth/login',{method:'POST',body:{username:'lifecycle-user',password:'Lifecycle-Pass-456'}});
   assert.equal(newSession.status,200);

   // Admin resets user password
   const resetRes=await call(`/api/admin/users/${testUserId}/reset-password`,{method:'POST',auth:admin,body:{password:'Lifecycle-Pass-789'}});
   assert.equal(resetRes.status,200);
   assert.equal((await call('/api/auth/login',{method:'POST',body:{username:'lifecycle-user',password:'Lifecycle-Pass-456'}})).status,401);
   assert.equal((await call('/api/auth/login',{method:'POST',body:{username:'lifecycle-user',password:'Lifecycle-Pass-789'}})).status,200);

   // Admin deactivates user
   const deactivateRes=await call(`/api/admin/users/${testUserId}`,{method:'PATCH',auth:admin,body:{active:false}});
   assert.equal(deactivateRes.status,200);
   assert.equal(deactivateRes.data.user.active,0);
   // Deactivated user cannot log in
   assert.equal((await call('/api/auth/login',{method:'POST',body:{username:'lifecycle-user',password:'Lifecycle-Pass-789'}})).status,401);

   // 4. Malformed Snapshot URI handling
   assert.equal((await call('/api/snapshots/%c0%ae%c0%ae',{auth:admin})).status,400);

   // 5. Prototype property pollution attempt on reviews
   assert.equal((await call('/api/reviews',{method:'PUT',auth:editor,body:{expectedRevision:1,key:'toString',value:{label:'VU_INTERNAL',fingerprint:'f',reason:'Valid reason here'}}} )).status,400);
  });
  await t.test('Backup command creates a consistent, reopenable SQLite copy and refuses overwrite',()=>{
   const destination=path.join(folder,'backup.sqlite'),script=fileURLToPath(new URL('../backend/manage.mjs',import.meta.url));
   const result=spawnSync(process.execPath,[script,'backup',destination],{env:{...process.env,VINMEC_DB:databasePath},encoding:'utf8'});assert.equal(result.status,0,result.stderr);
   const copy=openDatabase(destination);try{assert.equal(getWorkspace(copy).revision,getWorkspace(app.db).revision);assert.equal(copy.prepare('SELECT revision FROM review_state').get().revision,1)}finally{copy.close()}
   assert.equal(spawnSync(process.execPath,[script,'backup',destination],{env:{...process.env,VINMEC_DB:databasePath},encoding:'utf8'}).status,1);
  });
 }finally{await app.close();}
 const reopened=openDatabase(databasePath);try{assert.ok(getWorkspace(reopened).revision>0);assert.equal(getWorkspace(reopened).archivedReports.length,1);assert.ok(reopened.prepare('SELECT count(*) AS n FROM audit').get().n>0)}finally{reopened.close();await fs.rm(folder,{recursive:true,force:true})}
});
