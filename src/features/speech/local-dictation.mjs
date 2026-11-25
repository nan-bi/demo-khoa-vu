// PCM is sent only to the same-origin loopback proxy, never to a cloud STT API.
export function wavBlob(samples,sampleRate){
 const count=Math.floor(samples.length*16000/sampleRate),buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
 const word=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
 word(0,'RIFF');view.setUint32(4,36+count*2,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,count*2,true);
 // Average source samples when downsampling to reduce aliasing.
 for(let i=0;i<count;i++){let sum=0,n=0;for(let j=Math.floor(i*sampleRate/16000);j<Math.min(samples.length,Math.floor((i+1)*sampleRate/16000));j++){sum+=samples[j];n++;}const value=Math.max(-1,Math.min(1,sum/(n||1)));view.setInt16(44+i*2,value<0?value*32768:value*32767,true);}
 return new Blob([buffer],{type:'audio/wav'});
}

export function createLocalDictation({onText,onInterim,onState,onNotice,
 fetcher=fetch,mediaDevices=navigator.mediaDevices,AudioContextClass=window.AudioContext,onQuality=()=>{}}){
 let context,stream,source,filter,processor,mute,frames=[],length=0,silence=0,noiseFloor=0.005,queue=[],working=false,recording=false,failed=false,disposed=false,starting=false,generation=0;
 let segment=0,lastPreviewLength=0,previewSegment=null;
 const state=value=>{if(!disposed)onState(value);};
 function release(){recording=false;processor?.disconnect();filter?.disconnect();source?.disconnect();mute?.disconnect();stream?.getTracks().forEach(track=>track.stop());if(context)context.close().catch(()=>{});processor=source=mute=filter=null;stream=null;}
 function snapshot(){
  const samples=new Float32Array(length);let offset=0;for(const frame of frames){samples.set(frame,offset);offset+=frame.length;}
  return wavBlob(samples,context.sampleRate);
 }
 function flush(){
  if(!length)return;
  queue.push({id:segment++,body:snapshot(),final:true});frames=[];length=0;silence=0;lastPreviewLength=0;
  pump();
 }
 function previewReady(){return recording&&length-lastPreviewLength>=1.2*context.sampleRate;}
 async function pump(){
  if(working||failed||disposed)return;
  working=true;
  // Only one request at a time. Pending previews are coalesced into the latest
  // audio snapshot; complete segments always take priority and are never dropped.
  while(!disposed&&(queue.length||previewReady())){
   const task=queue[0]||{id:segment,body:snapshot(),final:false};
   if(!task.final)lastPreviewLength=length;
   try{
    const response=await fetcher('/speech-api/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav','X-Vu-Final':task.final?'1':'0'},body:task.body,signal:AbortSignal.timeout(120000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Chưa chép được âm thanh.');
    if(disposed)break;
    const text=result.text?.trim()||'';
    if(task.final){
     // Clear the replaceable hypothesis before appending its final version.
     // Never deduplicate words: repetitions or corrections may be intentional.
     if(previewSegment===task.id){onInterim('');previewSegment=null;}
     if(text)onText(text);
     if(result.needs_review||(result.corrections&&result.corrections.length)){
      onQuality({level:result.quality||(result.needs_review?'low':'ok'),reason:result.quality_reason||'Đã chuẩn hóa thuật ngữ; soát lại trước khi lưu.',confidence:result.confidence??null,corrections:result.corrections||[],rawText:result.raw_text||null,accentRegion:result.accent_region||null,text});
     }
     queue.shift();
    }else{previewSegment=task.id;onInterim(text);}
   }catch(e){
    failed=true;release();
    // A failed preview is not a committed chunk. Retain the entire active
    // segment (including its newest tail) once, alongside queued finals.
    flush();state('error');onNotice('Đã dừng micro. Âm thanh chưa chép còn tạm trong tab này; bấm Thử chép lại. '+(e.message||''));break;
   }
  }
  working=false;
  if(!queue.length&&!disposed&&!failed&&!recording&&!starting){onInterim('');previewSegment=null;state('idle');onNotice('Đã chép xong. Soát nội dung rồi hoàn thành ca.');}
 }
 return {
  async start(){
   if(recording||starting||working||queue.length||disposed)return;
   const attempt=++generation;
   let acquired,opened;
   starting=true;state('starting');
   try{
    const response=await fetcher('/speech-api/health',{signal:AbortSignal.timeout(5000)}),health=await response.json();
    if(!response.ok||!health.ready)throw new Error(health.error||'Model đang khởi động, thử lại sau vài giây.');
    if(disposed||attempt!==generation)return;
    acquired=await mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if(disposed||attempt!==generation){acquired.getTracks().forEach(track=>track.stop());return;}
    opened=new AudioContextClass({sampleRate:16000});await opened.resume();
    if(disposed||attempt!==generation){acquired.getTracks().forEach(track=>track.stop());await opened.close();return;}
    stream=acquired;context=opened;
    source=context.createMediaStreamSource(stream);
    filter=typeof context.createBiquadFilter==='function'?context.createBiquadFilter():null;
    if(filter){filter.type='highpass';filter.frequency.value=85;filter.Q.value=0.7;}
    processor=context.createScriptProcessor(4096,1,1);mute=context.createGain();mute.gain.value=0;
    if(filter){source.connect(filter);filter.connect(processor);}else{source.connect(processor);}
    processor.connect(mute);mute.connect(context.destination);
    stream.getTracks().forEach(track=>{track.onended=()=>{if(recording){release();flush();state(queue.length||working?'stopping':'idle');onNotice('Micro đã ngắt. Đang chép nốt âm thanh đã thu.');}};});
    frames=[];length=0;silence=0;noiseFloor=0.005;lastPreviewLength=0;previewSegment=null;onInterim('');recording=true;failed=false;
    processor.onaudioprocess=event=>{
     if(!recording)return;
     const frame=new Float32Array(event.inputBuffer.getChannelData(0));frames.push(frame);length+=frame.length;
     let energy=0;for(const x of frame)energy+=x*x;
     const rms=Math.sqrt(energy/frame.length);
     if(rms<noiseFloor*1.5||noiseFloor===0.005){noiseFloor=noiseFloor*0.95+rms*0.05;}else{noiseFloor=noiseFloor*0.999+rms*0.001;}
     noiseFloor=Math.max(0.003,Math.min(0.04,noiseFloor));
     const silenceThreshold=Math.max(0.008,Math.min(0.035,noiseFloor*1.35));
     silence=rms<silenceThreshold?silence+frame.length:0;
     // Silence chooses a sentence boundary (shortened to 0.45s for rapid dictation).
     // Live hypotheses retain the full current segment for context; final segments cover every sample once.
     if((length>=1.2*context.sampleRate&&silence>=.45*context.sampleRate)||length>=8*context.sampleRate)flush();
     else if(previewReady())pump();
     if(queue.length>=5){release();flush();state('stopping');onNotice('Máy đang chép chậm hơn lời đọc. Micro đã dừng để xử lý hết các đoạn đang chờ.');}
    };
    state('listening');onNotice((health.model?health.model+'. ':'')+'Đang nghe và cập nhật chữ liên tục trên máy. Đoạn đang nhận có thể đổi khi bạn đọc tiếp; bấm Dừng để chép nốt và soát nội dung.');
   }catch(e){acquired?.getTracks().forEach(track=>track.stop());if(opened&&opened!==context)opened.close().catch(()=>{});if(attempt===generation){release();state('idle');const reason=e.name==='NotAllowedError'?'Micro chưa được cấp quyền. Cho phép micro cho địa chỉ local trong trình duyệt rồi bấm Bắt đầu lại.':e.name==='NotFoundError'?'Không tìm thấy micro. Kết nối hoặc chọn micro trong cài đặt trình duyệt rồi thử lại.':e.name==='NotReadableError'?'Không mở được micro. Kiểm tra thiết bị hoặc ứng dụng khác đang dùng micro rồi thử lại.':e.message;onNotice('Chưa mở được nhận giọng nói: '+reason);}}
   finally{if(attempt===generation)starting=false;}
  },
  stop(){generation++;starting=false;if(recording){release();flush();}if(failed)return;if(queue.length||working)state('stopping');else state('idle');},
  retry(){if(!failed)return;failed=false;state('stopping');pump();},
  discard(){if(!failed)return;queue=[];frames=[];length=0;failed=false;previewSegment=null;onInterim('');state('idle');onNotice('Đã bỏ âm thanh chưa chép. Văn bản đã nhận vẫn được giữ; bổ sung phần thiếu trước khi lưu.');},
  hasPending(){return starting||recording||queue.length>0||working;},
  dispose(){disposed=true;generation++;starting=false;release();queue=[];frames=[];}
 };
}
