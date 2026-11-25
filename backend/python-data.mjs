import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./python/data_engine.py',import.meta.url));
const bundled=fileURLToPath(new URL('../.speech-venv/Scripts/python.exe',import.meta.url));
const fail=(status,message)=>Object.assign(Error(message),{status});
let running=0;
export const PUBLIC_TASKS=new Set(['department-revenue','finance-review','service-suggestions','identity-review','revenue','calculation','scope','aggregate','validate','ingest','prepare-import','evaluate-quality','template-model','template-workbook','meeting-model','meeting-presentation','snapshot']);
function safeEnv(){
 const allowed=['PATH','PATHEXT','SYSTEMROOT','TEMP','TMP','COMSPEC','USERPROFILE','WINDIR','APPDATA','LOCALAPPDATA'];
 const safe={};for(const k of allowed)if(process.env[k]!==undefined)safe[k]=process.env[k];
 return {...safe,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1'};
}
export function runPythonData(action,payload,{python=process.env.VINMEC_PYTHON||(existsSync(bundled)?bundled:'python'),timeout=120000}={}){
 if(running>=2)return Promise.reject(fail(429,'Đang xử lý dữ liệu Python. Thử lại sau.'));
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return Promise.reject(fail(400,'Cấu trúc tác vụ không hợp lệ.'));
 for(const rows of [payload.rows,payload.state?.rows,payload.current?.rows,payload.loaded?.rows])if(rows!=null&&(!Array.isArray(rows)||rows.length>100000))return Promise.reject(fail(400,'Tối đa 100.000 dòng mỗi tác vụ.'));
 const body=JSON.stringify({action,payload});if(Buffer.byteLength(body)>256*1024*1024)return Promise.reject(fail(413,'Tác vụ Python vượt 256 MB.'));
 running++;
 return new Promise((resolve,reject)=>{
  const started=performance.now(),child=spawn(python,['-I',script],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:safeEnv()});
  const chunks=[];let size=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);running--;if(error){child.kill();reject(error);}else resolve({...value,totalMs:Math.round((performance.now()-started)*1000)/1000});};
  const timer=setTimeout(()=>finish(fail(503,'Python xử lý quá thời gian; dữ liệu chưa được lưu.')),timeout);
  child.on('error',()=>finish(fail(503,'Chưa mở được Python. Chạy CAI-DAT-DU-LIEU-PYTHON.cmd hoặc đặt VINMEC_PYTHON.')));
  child.stdin.on('error',()=>finish(fail(503,'Chưa gửi được dữ liệu đến Python.')));
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>256*1024*1024)finish(fail(413,'Kết quả Python vượt 256 MB.'));else chunks.push(chunk);});
  child.stderr.resume();
  child.on('close',code=>{if(done)return;if(code!==0)return finish(fail(503,'Tiến trình Python kết thúc không thành công.'));
   try{const result=JSON.parse(Buffer.concat(chunks));if(!result.ok)return finish(fail([400,403,409,413,429,500,503].includes(result.status)?result.status:500,result.error||'Tác vụ Python không thành công.'));finish(null,result);}catch{finish(fail(503,'Python trả kết quả không hợp lệ.'));}
  });
  child.stdin.end(body);
 });
}
