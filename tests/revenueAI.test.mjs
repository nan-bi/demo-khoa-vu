import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import {trainRevenueModel,predictRevenue,revenueScope,validateLearning} from '../src/features/intelligence/revenueAI.mjs';
import {breastAggregate} from '../src/features/reports/breastRevenue.mjs';
import {serviceRevenueSnapshot,DEFAULT_SERVICE_KINDS} from '../src/features/reports/serviceCalculation.mjs';
import {prepareReportImport} from '../src/features/reports/prepareImport.mjs';
import {validate} from '../src/features/reports/core.mjs';
import {financeRoutes} from '../src/features/reports/reportScope.mjs';
import {templateWorkbook} from '../src/features/reports/templateExport.mjs';
import {meetingSlides} from '../src/features/reports/meetingExport.mjs';
import os from 'node:os';
import path from 'node:path';
import {createBackend} from '../backend/server.mjs';
import {createUser} from '../backend/auth.mjs';
import {getWorkspace,updateWorkspace} from '../backend/workspace.mjs';
import {saveCalculationConfig} from '../src/features/reports/serviceCalculation.mjs';
const seed=JSON.parse(fs.readFileSync(new URL('../src/data/seed.json',import.meta.url)));
const catalog=seed.DANH_MUC_DV.map(r=>({code:r['Mã dịch vụ mô phỏng'],name:r['Tên đơn vị dịch vụ mô phỏng'],group:r['Nhóm']}));
const base=()=>({...seed.CANONICAL.find(r=>r.status==='HOANTHANH'&&r.price_mode==='MUALE'&&+r.discount_known===1),ordering_dept:'VU',performing_dept:'VU'});
const config={packageTypes:{},serviceKinds:DEFAULT_SERVICE_KINDS};
function workbook(sheets,name='A.xlsx',folder=true){const book=XLSX.utils.book_new();for(const [key,rows] of Object.entries(sheets))XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),key);const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});return {name,webkitRelativePath:folder?'DATA/'+name:'',size:bytes.byteLength,arrayBuffer:async()=>bytes};}
test('Revenue scope counts VU ordered internal and outbound only, regardless of filenames or service names',()=>{
 const rows=[['VU','VU'],['VU','CDHA'],['KSKTQ','VU'],['NOI','CDHA'],['Không rõ','VU']].map(([a,b],i)=>({...base(),order_id:'R'+i,ordering_dept:a,performing_dept:b,source_file:'KHOA_VU.xlsx',service_name:'Siêu âm Vú'}));
 const s=revenueScope(rows);assert.deepEqual(s.included,rows.slice(0,2));assert.equal(s.excluded.length,2);assert.equal(s.pending.length,1);
 assert.equal(predictRevenue({...rows[4],source_file:'VU',unit_price_vnd:999999},s.model).label,null);
});
test('Exact Vietnamese department aliases are recognized but substrings never guessed',()=>{
 const m=trainRevenueModel();assert.equal(predictRevenue({ordering_dept:' Khoa Vú ',performing_dept:'Trung tâm Chẩn đoán hình ảnh'},m).label,'VU_OUTBOUND');
 assert.equal(predictRevenue({ordering_dept:'Không phải Khoa Vú',performing_dept:'VU'},m).label,null);
});
test('Learning retrains local NB, only confirmed pair can enter revenue, mutation invalidates match',()=>{
 const row={ordering_dept:'Trung tâm tuyến A',performing_dept:'Đơn vị kỹ thuật B'};
 const untrained=trainRevenueModel(),learned=trainRevenueModel([{...row,label:'VU_OUTBOUND',reason:'Đã đối chiếu danh mục khoa'}]);
 assert.equal(predictRevenue(row,untrained).pending,true);assert.equal(predictRevenue(row,learned).included,true);assert.notDeepEqual(untrained.documents,learned.documents);
 assert.equal(predictRevenue({...row,performing_dept:'Đơn vị mới'},learned).label,null);
 assert.ok(Number.isFinite(predictRevenue(row,learned).score));
 assert.ok(!JSON.stringify([...learned.vocabulary]).includes('patient_id'));
});
test('Contradictory labels, blank departments and duplicate teaching pairs are rejected',()=>{
 const e={ordering_dept:'CDHA',performing_dept:'VU',label:'VU_INTERNAL',reason:'Lý do đủ dài'};assert.throws(()=>validateLearning([e]),/mâu thuẫn/);
 const good={...e,ordering_dept:'Tên khoa mới',label:'VU_INBOUND'};assert.throws(()=>validateLearning([good,good]),/nhiều nhãn/);assert.throws(()=>validateLearning([{...good,performing_dept:''}]));
});
test('All revenue services, including external MRI/lab, have exact prices times quantity; no inbound',()=>{
 const r={...base(),service_code:'SYN-DV080',unit_price_vnd:3200000,completed_qty:2,quantity:2,completed_gross_vnd:6400000,completed_net_vnd:6400000,discount_vnd:0,performing_dept:'CDHA'};
 const s=serviceRevenueSnapshot([r,{...r,ordering_dept:'KSKTQ'}],config);assert.equal(s.department,'ORDERING_VU');assert.equal(s.knownRevenue,6400000);assert.equal(s.lines.length,1);assert.equal(s.lines[0].kind,'OTHER');
 const missing=serviceRevenueSnapshot([{...r,price_mode:'TRONGGOI',package_id:'UNKNOWN',package_allocation_vnd:null}],config);assert.equal(missing.knownRevenue,0);assert.equal(missing.missingRecords,1);
 assert.equal(serviceRevenueSnapshot([{...r,status:'HUY'}],config).knownRevenue,0);
});
test('Folder reads all sheets, quarantines unsupported summaries and preserves source location',async()=>{
 const a=base(),b={...base(),order_id:'B',visit_id:'V-B',patient_id:'P-B',ordering_dept:'CDHA'};
 const p=await prepareReportImport([workbook({Detail:[a],Other:[b],Summary:[{Tong:42}]})],{rows:[],hashes:[],revision:0},catalog);
 assert.equal(p.rows.length,2);assert.equal(p.skippedSheets.length,0);assert.equal(p.referenceTables.length,1);assert.equal(p.referenceTables[0].sheet,'Summary');assert.equal(p.referenceTables[0].rows[0].Tong,42);assert.equal(p.classification.included,1);assert.equal(p.classification.excluded,1);
 assert.deepEqual(p.rows.map(r=>r.source_sheet),['Detail','Other']);assert.equal(p.rows[0].source_file,'DATA/A.xlsx');assert.equal(p.rows[0].source_row,2);
});
test('Renamed identical workbook and duplicated sheet never increase quantity',async()=>{
 const a=base(),f=workbook({A:[a],B:[a]});const p=await prepareReportImport([f,{...f,name:'Renamed.xlsx',webkitRelativePath:'Other/Renamed.xlsx'}],{rows:[],hashes:[],revision:0},catalog);
 assert.equal(p.rows.length,1);assert.equal(p.duplicateCount,1);assert.equal(p.skippedFiles.length,1);
});
test('Different IDs on the same patient service event quarantine both, different visits remain distinct',()=>{
 const a=base(),b={...a,order_id:'DIFFERENT'};
 const s=validate([a,b],catalog,{suspectedDuplicates:true});assert.equal(s.valid.length,0);assert.equal(s.issues.length,2);
 assert.equal(validate([a,{...b,visit_id:'DISTINCT'}],catalog,{suspectedDuplicates:true}).valid.length,2);
});
test('Folder malformed bytes and total size are visible failures, not successful empty revenue',async()=>{
 const p=await prepareReportImport([{name:'bad.xlsx',webkitRelativePath:'DATA/bad.xlsx',size:3,arrayBuffer:async()=>new Uint8Array([0,1,2])}],{rows:[],hashes:[],revision:0},catalog);assert.equal(p.rows.length,0);assert.ok(p.skippedSheets.length);
});
test('New overview, revenue snapshot, finance partition and exported Excel/PPT share the same scope',async()=>{
 const a={...base(),service_code:'SYN-DV001',unit_price_vnd:12345,completed_qty:1,quantity:1,completed_gross_vnd:12345,completed_net_vnd:12345,discount_vnd:0},b={...a,order_id:'O2',visit_id:'V2',performing_dept:'CDHA'},c={...a,order_id:'O3',visit_id:'V3',ordering_dept:'KSKTQ'};
 const from=a.completed_at.slice(0,10),to=new Date(Date.parse(from)+86400000).toISOString().slice(0,10),stats=breastAggregate([a,b,c],catalog,from,to,config);
 assert.equal(stats.qty,2);assert.equal(stats.gross,24690);assert.equal(stats.classification.excluded,1);
 const serviceRevenue=serviceRevenueSnapshot(stats.completed,config);assert.equal(serviceRevenue.knownRevenue,24690);assert.equal(financeRoutes(stats.completed).find(r=>r.key==='OUTBOUND').gross,12345);
 const book=await templateWorkbook({rows:stats.completed,catalog,serviceRevenue,meta:{scope:stats.scopeLabel}});assert.equal(book.report.summary.gross,24690);assert.equal(book.report.sheets.find(s=>s.name==='GIA_X_SO_LUONG').rows.find(r=>r[0]==='TỔNG PHẦN ĐỦ GIÁ')[4],24690);
 const slides=await meetingSlides({status:'approved',stats,serviceRevenue});assert.ok(slides[0].note.includes('Khoa Vú chỉ định'));assert.ok(slides.some(s=>s.rows.some(r=>r.includes('12.345'))));
});
test('Folder accepts no HIS/order ID, finds title row, generates stable invisible keys across renames',async()=>{
 const row=base();delete row.order_id;delete row.his_order_id;
 const headers=Object.keys(row),grid=[['Báo cáo xuất dữ liệu'],[],headers,headers.map(k=>row[k])],book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(grid),'ChiTiet');
 const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'}),f={name:'NoID.xlsx',webkitRelativePath:'DATA/NoID.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes};
 const p=await prepareReportImport([f],{rows:[],hashes:[],revision:0},catalog);assert.equal(p.rows.length,1);assert.match(p.rows[0].order_id,/^LOCAL-[a-f0-9]{64}$/);assert.equal(p.rows[0].his_order_id,undefined);assert.equal(p.rows[0].source_row,4);assert.equal(p.issues.length,0);
 const again=await prepareReportImport([{...f,webkitRelativePath:'Renamed/NoID.xlsx'}],{rows:p.rows,hashes:[],revision:0},catalog);assert.equal(again.rows.length,0);assert.equal(again.duplicateCount,1);
});
test('Suspicious cross-key event with changed price is quarantined, not added twice',()=>{
 const a=base(),b={...a,order_id:'NEW-ID',unit_price_vnd:+a.unit_price_vnd+10,completed_gross_vnd:+a.completed_gross_vnd+10};
 assert.equal(validate([a,b],catalog,{suspectedDuplicates:true}).valid.length,0);
});
test('Unknown cancelled and out-of-snapshot rows do not block revenue snapshots',()=>{
 const row={...base(),ordering_dept:'Unknown'};const from=row.completed_at.slice(0,10),to=new Date(Date.parse(from)+86400000).toISOString().slice(0,10);
 assert.equal(breastAggregate([{...row,status:'HUY'},{...row,in_snapshot:0}],catalog,from,to).classification.pending,0);
 assert.equal(breastAggregate([row],catalog,from,to).classification.pending,1);
});
test('Backend persists training labels with audit, blocks pending revenue and recomputes scoped frozen snapshot',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vu-ai-'));
 const a={...base(),unit_price_vnd:1000,quantity:1,completed_qty:1,completed_gross_vnd:1000,completed_net_vnd:1000,discount_vnd:0},b={...a,order_id:'O-B',visit_id:'V-B',performing_dept:'CDHA'},c={...a,order_id:'O-C',visit_id:'V-C',ordering_dept:'KSKTQ'},unknown={...a,order_id:'O-U',visit_id:'V-U',ordering_dept:'Nguồn chưa rõ',performing_dept:'CDHA'};
 const initialState={version:1,revision:0,rows:[a,b,c,unknown],excluded:[],imports:[],hashes:[],logs:[],report:null};
 const app=await createBackend({databasePath:path.join(tmp,'test.sqlite'),initialState,catalog});const user=createUser(app.db,{username:'test-editor',password:'Temporary-Test-12345',role:'editor'});
 const from=a.completed_at.slice(0,10),to=new Date(Date.parse(from)+86400000).toISOString().slice(0,10);
 try{
  let state=getWorkspace(app.db);state.report={status:'draft',week:from,end:to,stats:{gross:999999}};
  await assert.rejects(()=>updateWorkspace(app.db,{expectedRevision:state.revision,state},user,catalog),/chưa xác định khoa/);
  state=getWorkspace(app.db);saveCalculationConfig(state,{...config,routingExamples:[{ordering_dept:'Nguồn chưa rõ',performing_dept:'CDHA',label:'EXTERNAL_UNRELATED',reason:'Đã xác nhận nguồn khoa khác'}]},'Nhập / đối soát','Học phân loại đã đối chiếu');
  state=await updateWorkspace(app.db,{expectedRevision:state.revision,state},user,catalog);assert.equal(state.serviceCalculation.routingExamples.length,1);assert.equal(state.calculationHistory[0].actor,user.username);
  state.report={status:'draft',week:from,end:to,stats:{gross:999999}};state=await updateWorkspace(app.db,{expectedRevision:state.revision,state},user,catalog);assert.equal(state.report.stats.gross,2000);assert.equal(state.report.stats.revenueScope,'ORDERING_VU');assert.equal(state.report.serviceRevenue.knownRevenue,2000);
  state.serviceCalculation.routingExamples=[];await assert.rejects(()=>updateWorkspace(app.db,{expectedRevision:state.revision,state},user,catalog),/khóa/);
 }finally{await app.close();fs.rmSync(tmp,{recursive:true,force:true});}
});
test('Unknown or low-confidence department pairs always trigger needs_review and appear in scope.needsReview',async()=>{
 const {CONFIDENCE_THRESHOLD}=await import('../src/features/intelligence/revenueAI.mjs');
 assert.equal(CONFIDENCE_THRESHOLD,0.75);
 const rows=[
  {...base(),ordering_dept:'VU',performing_dept:'CDHA'},
  {...base(),order_id:'O-UNK',visit_id:'V-UNK',ordering_dept:'Đơn vị lạ XYZ',performing_dept:'Phòng ABC'},
 ];
 const s=revenueScope(rows);
 assert.equal(s.records[0].needs_review,false);
 assert.equal(s.records[1].needs_review,true);
 assert.equal(s.needsReview.length,1);
 assert.equal(s.needsReview[0].row.order_id,'O-UNK');
 assert.ok(Number.isFinite(s.records[1].confidence));
});
