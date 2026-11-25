import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalDictation,wavBlob} from '../src/features/speech/local-dictation.mjs';

test('WAV is mono PCM16 at 16kHz after downsampling',async()=>{
 const blob=wavBlob(new Float32Array(48000).fill(0.5),48000),view=new DataView(await blob.arrayBuffer());
 assert.equal(blob.size,32044);assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(22,true),1);assert.equal(view.getInt16(44,true),16383);
});
function harness(replies=[]){
 let processor,stopped=0;const texts=[],states=[],calls=[],interims=[];
 const node=()=>({connect(){},disconnect(){},gain:{value:1}});
 class Audio{
  sampleRate=16000;destination={};resume(){return Promise.resolve();}close(){return Promise.resolve();}
  createMediaStreamSource(){return node();}createGain(){return node();}
  createScriptProcessor(){processor=node();return processor;}
 }
 const session=createLocalDictation({AudioContextClass:Audio,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})},
  fetcher:async(url,options)=>{calls.push({url,options});if(url.endsWith('health'))return {ok:true,json:async()=>({ready:true})};return await replies.shift()();},
  onText:t=>texts.push(t),onState:s=>states.push(s),onInterim:t=>interims.push(t),onNotice(){}});
 return {session,texts,states,calls,interims,get stopped(){return stopped;},frame(seconds,amp=.1){processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(seconds*16000).fill(amp)}});}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('stop drains final audio and keeps case locked until inference completes',async()=>{
 let finish;const h=harness([()=>new Promise(resolve=>finish=resolve)]);await h.session.start();h.frame(1);h.session.stop();
 assert.equal(h.session.hasPending(),true);assert.equal(h.stopped,1);assert.equal(h.states.at(-1),'stopping');
 finish({ok:true,json:async()=>({text:'Không thấy khối ở vú trái.'})});await tick();
 assert.deepEqual(h.texts,['Không thấy khối ở vú trái.']);assert.equal(h.session.hasPending(),false);assert.equal(h.states.at(-1),'idle');
});
test('failure retains original audio for retry without duplicate text',async()=>{
 const h=harness([async()=>{throw new Error('offline service');},async()=>({ok:true,json:async()=>({text:'Mười hai mi li mét.'})})]);
 await h.session.start();h.frame(1);h.session.stop();await tick();
 assert.equal(h.states.at(-1),'error');assert.equal(h.session.hasPending(),true);
 h.session.retry();await tick();assert.deepEqual(h.texts,['Mười hai mi li mét.']);
 const requests=h.calls.filter(c=>c.url.endsWith('transcribe'));assert.equal(requests[0].options.body,requests[1].options.body);
});
test('discard explicitly releases pending failed audio and allows manual correction',async()=>{
 const h=harness([async()=>{throw new Error('service stopped');}]);await h.session.start();h.frame(1);h.session.stop();await tick();h.session.discard();
 assert.equal(h.session.hasPending(),false);assert.equal(h.states.at(-1),'idle');assert.deepEqual(h.texts,[]);
});
test('switching away during mic permission prompt releases microphone',async()=>{
 let permit,stops=0;const states=[];
 const s=createLocalDictation({fetcher:async()=>({ok:true,json:async()=>({ready:true})}),mediaDevices:{getUserMedia:()=>new Promise(r=>permit=r)},AudioContextClass:class{},onText(){},onInterim(){},onState:x=>states.push(x),onNotice(){}});
 const start=s.start();await tick();s.stop();permit({getTracks:()=>[{stop(){stops++;}}]});await start;
 assert.equal(stops,1);assert.equal(s.hasPending(),false);assert.equal(states.at(-1),'idle');
});

const reply=text=>async()=>({ok:true,json:async()=>({text})});
const sizes=h=>h.calls.filter(c=>c.url.endsWith('transcribe')).map(c=>(c.options.body.size-44)/2);
test('words appear while listening, replace hypotheses, and commit only the final version',async()=>{
 const h=harness([reply('Vú phải'),reply('Vú phải không có khối'),reply('Vú phải không có khối bất thường.')]);
 await h.session.start();h.frame(1.3);await tick();
 assert.equal(h.states.at(-1),'listening');assert.equal(h.interims.at(-1),'Vú phải');assert.deepEqual(h.texts,[]);
 h.frame(1.3);await tick();assert.equal(h.interims.at(-1),'Vú phải không có khối');
 h.session.stop();await tick();
 assert.deepEqual(h.texts,['Vú phải không có khối bất thường.']);assert.equal(h.interims.at(-1),'');
 assert.deepEqual(sizes(h),[20800,41600,41600]);assert.equal(h.session.hasPending(),false);
});
test('slow preview coalesces to latest audio instead of queuing obsolete hypotheses',async()=>{
 let finish;const h=harness([()=>new Promise(r=>finish=r),reply('Đủ ngữ cảnh'),reply('Đủ ngữ cảnh cuối.')]);
 await h.session.start();h.frame(1.3);h.frame(1.3);h.frame(1.3);h.frame(1.3);
 assert.equal(sizes(h).length,1);
 finish({ok:true,json:async()=>({text:'Đang đọc'})});await tick();
 assert.deepEqual(sizes(h),[20800,83200]);assert.equal(h.interims.at(-1),'Đủ ngữ cảnh');
 h.session.stop();await tick();assert.deepEqual(h.texts,['Đủ ngữ cảnh cuối.']);
});
test('stop during preview waits for final tail and does not commit stale hypothesis',async()=>{
 let finish;const h=harness([()=>new Promise(r=>finish=r),reply('Kích thước mười hai mi li mét.')]);
 await h.session.start();h.frame(1.3);h.frame(.4);h.session.stop();
 assert.equal(h.states.at(-1),'stopping');assert.equal(h.session.hasPending(),true);
 finish({ok:true,json:async()=>({text:'Kích thước mười'})});await tick();
 assert.deepEqual(sizes(h),[20800,27200]);assert.deepEqual(h.texts,['Kích thước mười hai mi li mét.']);
 assert.equal(h.interims.at(-1),'');assert.equal(h.states.at(-1),'idle');
});
test('failed preview retains its whole segment once for retry, including newest tail',async()=>{
 let fail;const h=harness([()=>new Promise((_,reject)=>fail=reject),reply('Đã nhận đủ câu cuối.')]);
 await h.session.start();h.frame(1.3);h.frame(.4);fail(new Error('offline'));await tick();
 assert.equal(h.states.at(-1),'error');assert.equal(h.session.hasPending(),true);
 h.session.retry();await tick();
 assert.deepEqual(sizes(h),[20800,27200]);assert.deepEqual(h.texts,['Đã nhận đủ câu cuối.']);assert.equal(h.states.at(-1),'idle');
});
test('final boundaries preserve all captured audio and legitimate repeated words across sessions',async()=>{
 let finish;const h=harness([()=>new Promise(r=>finish=r),reply('Không có khối.'),reply('Không có khối.'),reply('Không có khối.')]);
 await h.session.start();h.frame(1.3);h.frame(7);h.frame(.4);h.session.stop();
 finish({ok:true,json:async()=>({text:'Không'})});await tick();
 assert.deepEqual(sizes(h),[20800,132800,6400]);
 assert.deepEqual(h.texts,['Không có khối.','Không có khối.']);
 await h.session.start();assert.equal(h.interims.at(-1),'');h.frame(.4);h.session.stop();await tick();
 assert.deepEqual(h.texts,['Không có khối.','Không có khối.','Không có khối.']);assert.equal(h.session.hasPending(),false);
});
test('empty final clears provisional words rather than saving an unconfirmed hypothesis',async()=>{
 const h=harness([reply('Có thể nghe nhầm'),reply('')]);await h.session.start();h.frame(1.3);await tick();
 h.session.stop();await tick();assert.deepEqual(h.texts,[]);assert.equal(h.interims.at(-1),'');assert.equal(h.states.at(-1),'idle');
});

test('preview uses fast decoding and final requests ask for careful decoding',async()=>{
 const h=harness([reply('Vú trái'),reply('Vú trái không có khối.')]);
 await h.session.start();h.frame(1.3);await tick();h.session.stop();await tick();
 assert.deepEqual(h.calls.filter(c=>c.url.endsWith('transcribe')).map(c=>c.options.headers['X-Vu-Final']),['0','1']);
});

test('biquad filter connects highpass when audio context supports it',async()=>{
 let filterCreated=null;
 class AudioWithFilter {
  sampleRate=16000;destination={};resume(){return Promise.resolve();}close(){return Promise.resolve();}
  createMediaStreamSource(){return {connect(){},disconnect(){}};}
  createGain(){return {connect(){},disconnect(){},gain:{value:0}};}
  createScriptProcessor(){return {connect(){},disconnect(){}};}
  createBiquadFilter(){
   filterCreated={type:'',frequency:{value:0},Q:{value:0},connect(){},disconnect(){}};
   return filterCreated;
  }
 }
 const s=createLocalDictation({AudioContextClass:AudioWithFilter,fetcher:async()=>({ok:true,json:async()=>({ready:true})}),mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})},onText(){},onInterim(){},onState(){},onNotice(){}});
 await s.start();
 assert.ok(filterCreated);
 assert.equal(filterCreated.type,'highpass');
 assert.equal(filterCreated.frequency.value,85);
 s.stop();
});

test('rapid speech boundary flushes at 450ms pause after 1.2s speech',async()=>{
 const h=harness([reply('Khối kích thước'),reply('Khối kích thước nhỏ')]);
 await h.session.start();
 h.frame(1.3);
 await tick();
 h.frame(0.45,0.001);
 await tick();
 assert.deepEqual(h.texts,['Khối kích thước nhỏ']);
 h.session.stop();
});
