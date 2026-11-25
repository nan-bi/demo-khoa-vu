import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const speechTestRoot=fileURLToPath(new URL('../speech-test-data/',import.meta.url));
const port=4173;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon','.wav':'audio/wav','.csv':'text/csv; charset=utf-8','.md':'text/plain; charset=utf-8'};
const SPEECH_CSP=[
 "default-src 'self'",
 "script-src 'self'",
 "style-src 'self' 'unsafe-inline'",
 "img-src 'self' data: blob:",
 "font-src 'self' data:",
 "connect-src 'self' http://127.0.0.1:4180 http://localhost:4180",
 "media-src 'self' blob:",
 "object-src 'none'",
 "base-uri 'self'",
 "form-action 'self'",
 "frame-ancestors 'self' http://127.0.0.1:4180 http://localhost:4180"
].join('; ');
if(Number(process.versions.node.split('.')[0])<22){console.error('Please install Node.js 22 or later: https://nodejs.org/');process.exit(1);}
try{await stat(path.join(root,'index.html'));}catch{console.error('Missing dist/index.html. Run npm ci and npm run build first.');process.exit(1);}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Security-Policy',SPEECH_CSP);
 res.setHeader('Permissions-Policy','camera=(), geolocation=(), payment=(), usb=(), microphone=(self)');
 res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.url?.startsWith('/speech-data/')){
  const origin=req.headers.origin;
  if(req.headers.host!==String('127.0.0.1:'+port)||(origin&&origin!=='http://127.0.0.1:'+port)||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403).end();return;}
  const op=req.url.slice('/speech-data/'.length),read=['session','results','drafts'].includes(op);
  if(!['session','results','drafts','save-draft','restore-draft','complete','review','migrate'].includes(op)||req.method!==(read?'GET':'POST')){res.writeHead(404).end();return;}
  const length=Number(req.headers['content-length']||0);
  if(!read&&(!origin||!Number.isInteger(length)||length<2||length>32*1024*1024||!(req.headers['content-type']||'').startsWith('application/json'))){res.writeHead(400).end();return;}
  const headers={Cookie:req.headers.cookie||'',Origin:'http://127.0.0.1:4180','Content-Type':'application/json','Content-Length':length,'X-CSRF-Token':req.headers['x-csrf-token']||''};
  const upstream=http.request({hostname:'127.0.0.1',port:4180,path:op==='session'?'/api/auth/session':'/api/speech/'+op,method:req.method,headers,timeout:30000},response=>{res.writeHead(response.statusCode,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.pipe(res);});
  upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Chưa mở kho ca local. Chạy CHAY-DASHBOARD-SPEECH.cmd.'}));});
  req.pipe(upstream);return;
 }
 if(req.url?.startsWith('/speech-api/')){
  const origin=req.headers.origin;
  if(req.headers.host!==`127.0.0.1:${port}`||(origin&&origin!==`http://127.0.0.1:${port}`)||req.headers['sec-fetch-site']==='cross-site'){
   res.writeHead(403).end();return;
  }
  const route=req.url.slice('/speech-api'.length);
  if(!process.env.VU_VOICE_KEY){res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Mở CHAY-SPEECH.cmd để chạy model trên máy.'}));return;}
  if(!((route==='/health'&&req.method==='GET')||(route==='/transcribe'&&req.method==='POST'))){res.writeHead(404).end();return;}
  const length=Number(req.headers['content-length']||0);
  if(req.method==='POST'&&(!Number.isInteger(length)||length<=44||length>960044)){res.writeHead(413).end();return;}
  const upstream=http.request({hostname:'127.0.0.1',port:4181,path:route,method:req.method,headers:{'X-Vu-Key':process.env.VU_VOICE_KEY,'X-Vu-Final':req.headers['x-vu-final']==='0'?'0':'1','Content-Type':'audio/wav','Content-Length':length},timeout:120000},response=>{
   res.writeHead(response.statusCode,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy());
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Dịch vụ STT chưa sẵn sàng. Mở lại CHAY-SPEECH.cmd.'}));});
  req.pipe(upstream);return;
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'}).end();return;}
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  if(pathname.includes('\0')){res.writeHead(400).end('Bad request');return;}
  const isSpeechTest=pathname.startsWith('/speech-test/');
  const selectedRoot=isSpeechTest?speechTestRoot:root;
  const localPath=isSpeechTest?(pathname.slice('/speech-test'.length)==='/'?'/index.html':pathname.slice('/speech-test'.length)):(pathname==='/'?'/index.html':pathname==='/speech-dashboard.html'?'/speech.html':pathname);
  const target=path.resolve(selectedRoot,'.'+localPath);
  const relative=path.relative(selectedRoot,target);
  if(relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(403).end('Forbidden');return;}
  const data=await readFile(target);
  res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch(e){res.writeHead(e.code==='ENOENT'||e.code==='EISDIR'?404:400).end('File unavailable');}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port 4173 is already in use. Close the previous demo terminal or open http://127.0.0.1:4173/':e.message);process.exit(1);});
server.listen(port,'127.0.0.1',()=>console.log('\nVinMec Khoa Vu - local demo\nOpen: http://127.0.0.1:4173/\nStop: Ctrl+C\nSynthetic data only.\n'));
