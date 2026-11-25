import {REVENUE_FIELDS} from '../src/features/reports/calculationPayload.mjs';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {revenueCalculation,validateRates,SERVICE_KINDS} from '../src/features/reports/serviceCalculation.mjs';
const script=fileURLToPath(new URL('./python/revenue_engine.py',import.meta.url));
const bundled=fileURLToPath(new URL('../.speech-venv/Scripts/python.exe',import.meta.url));
let running=0;
const fail=(status,message)=>Object.assign(Error(message),{status});
export const revenueFields=REVENUE_FIELDS;
export function calculationInput(rows,config={}){
 if(!Array.isArray(rows)||rows.length>100000||!config||typeof config!=='object'||Array.isArray(config))throw fail(400,'Cấu trúc phép tính không hợp lệ hoặc vượt 100.000 dòng.');
 for(const key of ['rates','serviceKinds','packageTypes'])if(config[key]!=null&&(typeof config[key]!=='object'||Array.isArray(config[key])))throw fail(400,'Cấu hình phép tính không hợp lệ.');
 try{validateRates(config.rates);}catch(e){throw fail(400,e.message);}
 if(Object.values(config.serviceKinds||{}).some(k=>!Object.hasOwn(SERVICE_KINDS,k))||Object.values(config.packageTypes||{}).some(k=>!['SKTQ','SLUT1','SLUT2','OTHER','UNKNOWN'].includes(k)))throw fail(400,'Phân loại gói hoặc dịch vụ không hợp lệ.');
 const clean=rows.map(row=>{
  if(!row||typeof row!=='object'||typeof row.service_code!=='string'||typeof row.service_name!=='string')throw fail(400,'Dòng dịch vụ thiếu mã hoặc tên.');
  return Object.fromEntries(revenueFields.map(key=>[key,row[key]??null]));
 });
 return {rows:clean,config:Object.fromEntries(['rates','serviceKinds','packageTypes'].filter(k=>config[k]!=null).map(k=>[k,config[k]]))};
}
function safeEnv(){
 const allowed=['PATH','PATHEXT','SYSTEMROOT','TEMP','TMP','COMSPEC','USERPROFILE','WINDIR','APPDATA','LOCALAPPDATA'];
 const safe={};for(const k of allowed)if(process.env[k]!==undefined)safe[k]=process.env[k];
 return {...safe,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1'};
}
export function runPythonRevenue(payload,{python=process.env.VINMEC_PYTHON||(existsSync(bundled)?bundled:'python'),timeout=20000}={}){
 if(running>=2)return Promise.reject(fail(429,'Đang chạy hai phép tính Python. Thử lại sau.'));
 const body=JSON.stringify(payload);if(Buffer.byteLength(body)>32*1024*1024)return Promise.reject(fail(413,'Phép tính vượt 32 MB.'));
 running++;
 return new Promise((resolve,reject)=>{
  const started=performance.now(),child=spawn(python,['-I',script],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:safeEnv()});
  const chunks=[];let size=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);running--;if(error){child.kill();reject(error);}else resolve({...value,totalMs:Math.round((performance.now()-started)*1000)/1000});};
  const timer=setTimeout(()=>finish(fail(503,'Python xử lý quá thời gian. Giữ phép tính JavaScript.')),timeout);
  child.on('error',()=>finish(fail(503,'Chưa mở được Python. Cài Python hoặc đặt VINMEC_PYTHON đến python.exe.')));
  child.stdin.on('error',()=>finish(fail(503,'Chưa gửi được dữ liệu đến Python.')));
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>24*1024*1024)finish(fail(413,'Kết quả Python vượt giới hạn.'));else chunks.push(chunk);});
  child.stderr.resume();
  child.on('close',code=>{if(done)return;if(code!==0){finish(fail(503,'Tiến trình Python kết thúc không thành công.'));return;}
   try{const result=JSON.parse(Buffer.concat(chunks));if(!result.ok){finish(fail(400,result.error));return;}finish(null,result);}catch{finish(fail(503,'Python trả kết quả không hợp lệ.'));}
  });
  child.stdin.end(body);
 });
}
export async function compareRevenue(rows,config,options){
 const payload=calculationInput(rows,config),start=performance.now();let javascript;
 try{javascript=revenueCalculation(payload.rows,payload.config);}catch(e){throw fail(400,e.message);}
 const javascriptMs=performance.now()-start,python=await runPythonRevenue(payload,options);
 return {match:isDeepStrictEqual(javascript,python.value),rows:payload.rows.length,javascript,python:python.value,
  timing:{javascriptMs,pythonComputeMs:python.computeMs,pythonTotalMs:python.totalMs},scope:'PRICE-QTY-1 · cùng dòng đã lọc, phân loại khoa giữ JavaScript'};
}
