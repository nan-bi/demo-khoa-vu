import {extendCatalog} from '../src/features/reports/serviceCatalog.mjs';
import {runPythonData,PUBLIC_TASKS} from './python-data.mjs';
import {compareRevenue} from './python-revenue.mjs';
import {openSpeechStore} from './speech-store.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openDatabase,audit,transaction} from './database.mjs';
import {authenticate,createSession,getSession,hashToken,createUser,changePassword,setUserActive,setUserRole,validatePassword} from './auth.mjs';
import {getWorkspace,seedWorkspace,updateWorkspace,HttpError} from './workspace.mjs';
import {emptyWorkspace} from '../src/features/reports/operationalState.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};

const CSP_POLICY=[
 "default-src 'self'",
 "script-src 'self'",
 "style-src 'self' 'unsafe-inline'",
 "img-src 'self' data: blob:",
 "font-src 'self' data:",
 "connect-src 'self'",
 "frame-src 'self' http://127.0.0.1:4173 http://localhost:4173",
 "media-src 'self' blob:",
 "object-src 'none'",
 "base-uri 'self'",
 "form-action 'self'",
 "frame-ancestors 'none'"
].join('; ');

class LoginRateLimiter{
 constructor(maxAttempts=10,windowMs=15*60*1000,maxEntries=2000){
  this.maxAttempts=maxAttempts;this.windowMs=windowMs;this.maxEntries=maxEntries;this.attempts=new Map();
 }
 prune(now=Date.now()){
  for(const[k,v]of this.attempts)if(v.until<=now)this.attempts.delete(k);
  if(this.attempts.size>this.maxEntries){
   let excess=this.attempts.size-this.maxEntries;
   for(const k of this.attempts.keys()){this.attempts.delete(k);if(--excess<=0)break;}
  }
 }
 isBlocked(key,now=Date.now()){
  this.prune(now);const a=this.attempts.get(key);return Boolean(a&&a.until>now&&a.count>=this.maxAttempts);
 }
 record(key,now=Date.now()){
  this.prune(now);const prev=this.attempts.get(key);
  const cur=prev&&prev.until>now?prev:{count:0,until:now+this.windowMs};
  this.attempts.set(key,{count:cur.count+1,until:cur.until});
 }
 reset(key){this.attempts.delete(key);}
}

function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));}
async function body(req,limit){
 const cl=Number(req.headers['content-length']);
 if(Number.isFinite(cl)&&cl>limit)throw new HttpError(413,'Nội dung vượt giới hạn.');
 let size=0;const chunks=[];
 for await(const c of req){size+=c.length;if(size>limit)throw new HttpError(413,'Nội dung vượt giới hạn.');chunks.push(c)}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new HttpError(400,'JSON không hợp lệ.')}
}
export async function createBackend({databasePath=path.join(project,'backend/data/vinmec.sqlite'),dist=path.join(project,'dist'),initialState,catalog:providedCatalog,secureCookie=false,speechPath=databasePath===path.join(project,'backend/data/vinmec.sqlite')?path.join(project,'speech-data/ca-speech.sqlite'):databasePath+'.speech.sqlite'}={}){
 const db=openDatabase(databasePath);let speechStore;
 const seed=JSON.parse(await readFile(path.join(project,'src/data/seed.json'),'utf8'));
 const catalog=providedCatalog||seed.DANH_MUC_DV.map(r=>({code:r['Mã dịch vụ mô phỏng'],name:r['Tên đơn vị dịch vụ mô phỏng'],group:r['Nhóm'],dept:r['Khoa thực hiện mô phỏng'],price:r['Giá SIM-P2 (VND)']}));
 seedWorkspace(db,initialState||emptyWorkspace());
 const limiter=new LoginRateLimiter();
 const cookie=token=>`vinmec_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie?'; Secure':''}`;
 const server=http.createServer(async(req,res)=>{
  const requestId=randomUUID();
  res.setHeader('X-Request-ID',requestId);
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',CSP_POLICY);
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies','none');
  if(secureCookie)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  try{
   const host=req.headers.host||'';
   if(!host||/[\r\n\0\s]/.test(host)||host.length>256)throw new HttpError(400,'Host header không hợp lệ.');
   const url=new URL(req.url,'http://localhost'),route=url.pathname;
   if(route.startsWith('/api/')&&req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Yêu cầu cross-site bị chặn.');
   // No CORS: browser mutations must come from the same origin as the dashboard.
   if(!['GET','HEAD'].includes(req.method)){
    if(!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host)throw new HttpError(403,'Nguồn yêu cầu không hợp lệ.');
    if(!(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Yêu cầu application/json.');
   }
   if(route==='/api/health'&&req.method==='GET')return send(res,200,{service:'vinmec-internal-backend',status:'ok',version:1,setupRequired:!db.prepare('SELECT 1 FROM users WHERE active=1 LIMIT 1').get()});
   if(route==='/api/auth/login'&&req.method==='POST'){
    const ip=req.socket.remoteAddress||'127.0.0.1',now=Date.now(),ipKey='ip:'+ip;
    if(limiter.isBlocked(ipKey,now))throw new HttpError(429,'Quá nhiều lần đăng nhập từ địa chỉ này. Thử lại sau 15 phút.');
    const b=await body(req,4096);
    const usernameKey='user:'+String(b.username||'').toLowerCase();
    if(limiter.isBlocked(usernameKey,now))throw new HttpError(429,'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau 15 phút.');
    const user=authenticate(db,b.username,b.password);
    if(!user){
     limiter.record(ipKey,now);
     limiter.record(usernameKey,now);
     audit(db,null,'LOGIN_FAILED',{username:b.username?String(b.username).slice(0,64):'unknown',ip});
     throw new HttpError(401,'Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    limiter.reset(ipKey);limiter.reset(usernameKey);
    const session=createSession(db,user);
    audit(db,user,'LOGIN',{ip});
    return send(res,200,{user,csrf:session.csrf,expires:session.expires},{'Set-Cookie':cookie(session.token)});
   }
   if(route.startsWith('/api/')){
    const session=getSession(db,req.headers.cookie);if(!session)throw new HttpError(401,'Cần đăng nhập.');
    if(!['GET','HEAD'].includes(req.method)&&req.headers['x-csrf-token']!==session.csrf)throw new HttpError(403,'Mã bảo vệ phiên không hợp lệ.');
    const user=session.user;
    if(route==='/api/auth/session'&&req.method==='GET')return send(res,200,{user,csrf:session.csrf,expires:session.expires});
    if(route==='/api/auth/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(session.token));audit(db,user,'LOGOUT',{ip:req.socket.remoteAddress});return send(res,200,{ok:true},{'Set-Cookie':'vinmec_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
    if(route==='/api/auth/change-password'&&req.method==='POST'){
     const b=await body(req,4096);
     if(!b||typeof b.oldPassword!=='string'||typeof b.newPassword!=='string')throw new HttpError(400,'Thiếu mật khẩu cũ hoặc mật khẩu mới.');
     const check=authenticate(db,user.username,b.oldPassword);
     if(!check)throw new HttpError(401,'Mật khẩu hiện tại không đúng.');
     try{changePassword(db,user.id,b.newPassword,user);}catch(e){throw new HttpError(400,e.message);}
     const nextSession=createSession(db,user);
     return send(res,200,{ok:true,csrf:nextSession.csrf,expires:nextSession.expires},{'Set-Cookie':cookie(nextSession.token)});
    }
    if(route.startsWith('/api/speech/')){
     const operation=route.slice('/api/speech/'.length);
     const read=['results','drafts'].includes(operation);
     if((read&&req.method!=='GET')||(!read&&req.method!=='POST'))throw new HttpError(405,'Phương thức không hợp lệ.');
     if(!read&&!['admin','editor','reviewer'].includes(user.role))throw new HttpError(403,'Không có quyền lưu hoặc chuyển dữ liệu ca.');
     speechStore??=openSpeechStore(speechPath);
     const data=read?undefined:await body(req,32*1024*1024);
     return send(res,200,speechStore.run(operation,data,user.username));
    }
    if(route==='/api/calculation/compare'){
     if(req.method!=='POST')throw new HttpError(405,'Dùng POST để đối chiếu phép tính.');
     const payload=await body(req,32*1024*1024);
     return send(res,200,await compareRevenue(payload.rows,payload.config));
    }
    if(route.startsWith('/api/data/')){
     const action=route.slice('/api/data/'.length);
     if(req.method!=='POST')throw new HttpError(405,'Dùng POST để xử lý dữ liệu.');
     if(!PUBLIC_TASKS.has(action))throw new HttpError(404,'Không có tác vụ dữ liệu này.');
     const payload=await body(req,action==='ingest'?140*1024*1024:256*1024*1024);
     if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new HttpError(400,'Cấu trúc tác vụ dữ liệu không hợp lệ.');
     // Read/compute only. Persistence always goes through the revision-locked
     // workspace endpoint with server-side roles and transition validation.
     if(action!=='ingest'&&!action.startsWith('meeting-'))payload.catalog=extendCatalog(catalog,getWorkspace(db).serviceCalculation);
     const result=await runPythonData(action,payload);
     return send(res,200,{value:result.value,engine:'python',computeMs:result.computeMs});
    }
    if(route==='/api/workspace'&&req.method==='GET')return send(res,200,getWorkspace(db));
    if(route==='/api/workspace'&&req.method==='PUT')return send(res,200,await updateWorkspace(db,await body(req,256*1024*1024),user,catalog));
    if(route==='/api/catalog'&&req.method==='GET')return send(res,200,{services:extendCatalog(catalog,getWorkspace(db).serviceCalculation)});
    if(route==='/api/reviews'&&req.method==='GET')return send(res,200,JSON.parse(db.prepare('SELECT payload FROM review_state WHERE id=1').get().payload));
    if(route==='/api/reviews'&&req.method==='PUT'){
     if(!['admin','editor'].includes(user.role))throw new HttpError(403,'Không có quyền gán nhãn dữ liệu.');
     const b=await body(req,16384),v=b.value;
     if(typeof b.key!=='string'||!b.key||b.key.length>500||Object.hasOwn(Object.prototype,b.key)||['__proto__','constructor','prototype'].includes(b.key)||!v||!['VU_INTERNAL','VU_OUTBOUND','VU_INBOUND','EXTERNAL_UNRELATED'].includes(v.label)||typeof v.fingerprint!=='string'||typeof v.reason!=='string'||v.reason.trim().length<8||v.reason.length>1000)throw new HttpError(400,'Nhãn hoặc căn cứ xác nhận không hợp lệ.');
     const state=transaction(db,()=>{const s=JSON.parse(db.prepare('SELECT payload FROM review_state WHERE id=1').get().payload);if(s.revision!==b.expectedRevision)throw new HttpError(409,'Nhãn đã được cập nhật ở phiên khác.');s.items[b.key]={label:v.label,fingerprint:v.fingerprint,reason:v.reason,profile:v.profile,rulesVersion:v.rulesVersion,reviewer:user.username,reviewedAt:new Date().toISOString()};s.revision++;db.prepare('UPDATE review_state SET revision=?,payload=? WHERE id=1').run(s.revision,JSON.stringify(s));audit(db,user,'REVIEW_SAVED',{key:b.key,label:v.label},s.revision);return s});return send(res,200,state);
    }
    if(route==='/api/snapshots'&&req.method==='GET')return send(res,200,{snapshots:db.prepare('SELECT id,created_at FROM snapshots ORDER BY created_at DESC').all()});
    if(route.startsWith('/api/snapshots/')&&req.method==='GET'){
     let snapshotId;
     try{snapshotId=decodeURIComponent(route.slice(15));}catch{throw new HttpError(400,'Mã snapshot không hợp lệ.');}
     if(snapshotId.includes('\0')||snapshotId.length>500)throw new HttpError(400,'Mã snapshot không hợp lệ.');
     const row=db.prepare('SELECT payload FROM snapshots WHERE id=?').get(snapshotId);
     if(!row)throw new HttpError(404,'Không tìm thấy snapshot.');
     return send(res,200,JSON.parse(row.payload));
    }
    if(route==='/api/admin/users'){
     if(user.role!=='admin')throw new HttpError(403,'Chỉ quản trị viên được quản lý tài khoản.');
     if(req.method==='GET')return send(res,200,{users:db.prepare('SELECT id,username,role,active,created_at FROM users ORDER BY id').all()});
     if(req.method==='POST'){const b=await body(req,4096);let created;try{created=createUser(db,b,user)}catch(e){throw new HttpError(e.message.includes('UNIQUE')?409:400,e.message.includes('UNIQUE')?'Tên đăng nhập đã tồn tại.':e.message)}audit(db,user,'ADMIN_CREATED_USER',{userId:created.id,role:created.role});return send(res,201,{user:created});}
    }
    if(route.startsWith('/api/admin/users/')&&!route.endsWith('/reset-password')&&req.method==='PATCH'){
     if(user.role!=='admin')throw new HttpError(403,'Chỉ quản trị viên được quản lý tài khoản.');
     const targetId=Number(route.slice('/api/admin/users/'.length));
     if(!Number.isSafeInteger(targetId)||targetId<1)throw new HttpError(400,'Mã người dùng không hợp lệ.');
     const b=await body(req,4096);
     if(b.active!==undefined)setUserActive(db,targetId,Boolean(b.active),user);
     if(b.role!==undefined)setUserRole(db,targetId,b.role,user);
     const updated=db.prepare('SELECT id,username,role,active,created_at FROM users WHERE id=?').get(targetId);
     if(!updated)throw new HttpError(404,'Không tìm thấy người dùng.');
     return send(res,200,{user:updated});
    }
    if(route.startsWith('/api/admin/users/')&&route.endsWith('/reset-password')&&req.method==='POST'){
     if(user.role!=='admin')throw new HttpError(403,'Chỉ quản trị viên được quản lý tài khoản.');
     const targetId=Number(route.slice('/api/admin/users/'.length,-'/reset-password'.length));
     if(!Number.isSafeInteger(targetId)||targetId<1)throw new HttpError(400,'Mã người dùng không hợp lệ.');
     const b=await body(req,4096);
     if(!b||typeof b.password!=='string')throw new HttpError(400,'Mật khẩu mới không hợp lệ.');
     try{changePassword(db,targetId,b.password,user);}catch(e){throw new HttpError(400,e.message);}
     return send(res,200,{ok:true});
    }
    if(route==='/api/admin/audit'&&req.method==='GET'){
     if(user.role!=='admin')throw new HttpError(403,'Chỉ quản trị viên được xem nhật ký hệ thống.');
     const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)throw new HttpError(400,'Con trỏ nhật ký không hợp lệ.');
     return send(res,200,{events:db.prepare('SELECT * FROM audit WHERE id<? ORDER BY id DESC LIMIT 100').all(before)});
    }
    throw new HttpError(404,'Không có đường dẫn nội bộ này.');
   }
   if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Phương thức không được hỗ trợ.');
   let decodedRoute;
   try{decodedRoute=decodeURIComponent(route);}catch{throw new HttpError(400,'Đường dẫn không hợp lệ.');}
   if(decodedRoute.includes('\0'))throw new HttpError(400,'Đường dẫn không hợp lệ.');
   const target=path.resolve(dist,'.'+(route==='/'?'/index.html':decodedRoute)),relative=path.relative(dist,target);
   if(relative.startsWith('..')||path.isAbsolute(relative))throw new HttpError(403,'Không được truy cập đường dẫn này.');
   let data;try{data=await readFile(target)}catch{throw new HttpError(404,'Không có file. Chạy npm run build nếu chưa có dashboard.');}
   res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){const status=e.status||500;if(status===500)console.error(`[${requestId}] Backend error:`,e.message);if(!res.headersSent)send(res,status,{error:status===500?'Lỗi hệ thống nội bộ.':e.message,requestId});else res.end();}
 });
 server.requestTimeout=120000;server.headersTimeout=10000;
 return {server,db,close:async()=>{server.closeIdleConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));speechStore?.close();db.close()}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.VINMEC_PORT||4180),host=process.env.VINMEC_HOST||'127.0.0.1';
 const app=await createBackend({databasePath:process.env.VINMEC_DB||path.join(project,'backend/data/vinmec.sqlite'),secureCookie:process.env.VINMEC_SECURE_COOKIE==='1'});
 app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is already in use.`:e.message);app.db.close();process.exitCode=1});
 app.server.listen(port,host,()=>console.log(`VinMec internal dashboard: http://${host}:${port}/\nDatabase: ${process.env.VINMEC_DB||path.join(project,'backend/data/vinmec.sqlite')}\nCreate account: node backend/manage.mjs create-user\nNo external API or cloud service.`));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
