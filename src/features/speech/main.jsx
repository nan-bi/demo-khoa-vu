import {isLeaveRequest,leaveBlocked} from './embed-bridge.mjs';
import React,{useReducer,useState,useRef,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {blank,reducer,missing,reportText} from './model.mjs';
import {createLocalDictation} from './local-dictation.mjs';
import {deviceStamp,showTime} from './clock.mjs';
import {completedRecord,listResults,saveCompletedResult,listDrafts,saveDraft,restoreDraft,hasDraftContent} from './results.mjs';
import {browserStorageStatus} from './browser-storage.mjs';
import {prepareOffline} from './offline.mjs';
import ResultsPanel from './ResultsPanel.jsx';
import './speech.css';

function DeviceClock(){
 const [stamp,setStamp]=useState(deviceStamp);
 useEffect(()=>{const timer=setInterval(()=>setStamp(deviceStamp()),1000);return()=>clearInterval(timer);},[]);
 return <div className="device-clock"><span>ĐỒNG HỒ THIẾT BỊ</span><time dateTime={stamp.iso}>{showTime(stamp)}</time></div>;
}
function SpeechApp(){
 const [s,dispatch]=useReducer(reducer,null,blank),[consent,setConsent]=useState(false),[phase,setPhase]=useState('idle'),[interim,setInterim]=useState(''),[notice,setNotice]=useState('Bấm Bắt đầu để nghe và chép lời đọc. Có thể bổ sung thông tin ca sau khi dừng, trước khi lưu kết quả.');
 const [speechQuality,setSpeechQuality]=useState(null);
 const [persistence,setPersistence]=useState('checking');
 const [page,setPage]=useState('record'),[records,setRecords]=useState([]),[loading,setLoading]=useState(true),[storageError,setStorageError]=useState(''),[saving,setSaving]=useState(false),[printTarget,setPrintTarget]=useState(null);
 const [drafts,setDrafts]=useState([]),[draftPhase,setDraftPhase]=useState('idle'),[draftError,setDraftError]=useState(''),[draftAt,setDraftAt]=useState(null),[switching,setSwitching]=useState(false),[online,setOnline]=useState(navigator.onLine),[offlineState,setOfflineState]=useState('preparing'),[offlineError,setOfflineError]=useState('');
 const draftIdentity=useRef(null),draftQueue=useRef(Promise.resolve()),savedDraftState=useRef(null);
 if(!draftIdentity.current)draftIdentity.current={id:crypto.randomUUID(),owner:crypto.randomUUID()};
 const transcriptBox=useRef(null);
 const session=useRef(null),sRef=useRef(s),savingRef=useRef(false);sRef.current=s;
 const reviewPending=useRef(false),switchingRef=useRef(false);switchingRef.current=switching;
 const setReviewPending=React.useCallback(value=>{reviewPending.current=value;},[]);
 const keepInBrowser=async()=>setPersistence(await browserStorageStatus(navigator.storage,true));
 const pendingWork=()=>leaveBlocked({audio:session.current?.hasPending(),draft:!sRef.current.savedId&&hasDraftContent(sRef.current)&&savedDraftState.current!==sRef.current,saving:savingRef.current,review:reviewPending.current,switching:switchingRef.current});
 useEffect(()=>{const receive=event=>{if(!isLeaveRequest(event,window.parent)||window.parent===window)return;event.source.postMessage({type:'vu-speech:leave-state',id:event.data.id,blocked:pendingWork()},event.origin);};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[]);
 const audioSupported=!!(navigator.mediaDevices?.getUserMedia&&window.AudioContext);
 const busy=phase!=='idle',issues=missing(s);
 const visibleTranscript=[s.transcript,interim].filter(Boolean).join(' ');
 useEffect(()=>{if(busy&&transcriptBox.current)transcriptBox.current.scrollTop=transcriptBox.current.scrollHeight;},[visibleTranscript,busy]);
 const locked=busy||saving||switching||!!s.savedId;
 async function refreshResults(){setLoading(true);setStorageError('');try{setRecords(await listResults());}catch(e){setStorageError(e.message);}finally{setLoading(false);}}
 async function refreshDrafts(){try{setDrafts((await listDrafts()).filter(d=>d.id!==draftIdentity.current.id));}catch(e){setDraftError(e.message);}}
 useEffect(()=>{refreshResults();browserStorageStatus().then(setPersistence);},[]);
 useEffect(()=>{refreshDrafts();},[]);
 useEffect(()=>{
  const network=()=>setOnline(navigator.onLine);
  window.addEventListener('online',network);window.addEventListener('offline',network);
  let alive=true;
  if(import.meta.env.PROD)prepareOffline().then(()=>{if(alive)setOfflineState('ready');}).catch(e=>{if(alive){setOfflineState('error');setOfflineError(e.message);}});
  else{setOfflineState('error');setOfflineError('Chế độ phát triển cần máy chủ. Dùng bản CHAY-SPEECH để mở lại ngoại tuyến.');}
  return()=>{alive=false;window.removeEventListener('online',network);window.removeEventListener('offline',network);};
 },[]);
 useEffect(()=>{
  if(s.savedId||(!hasDraftContent(s)&&!draftIdentity.current.scheduled&&!draftIdentity.current.claimed))return;
  const identity=draftIdentity.current;
  identity.scheduled=true;
  setDraftPhase('saving');
  const job=draftQueue.current.catch(()=>{}).then(()=>saveDraft(identity,s));
  draftQueue.current=job;
  job.then(draft=>{
   if(draftIdentity.current===identity&&sRef.current===s){savedDraftState.current=s;setDraftAt(draft.updatedAt);setDraftPhase('saved');setDraftError('');}
  }).catch(e=>{if(draftIdentity.current===identity){setDraftPhase('error');setDraftError(e.message);}});
 },[s]);
 useEffect(()=>{if(printTarget){window.print();setPrintTarget(null);}},[printTarget]);
 useEffect(()=>{
  if(audioSupported)session.current=createLocalDictation({onText:text=>dispatch({type:'append',text}),onInterim:setInterim,onState:setPhase,onNotice:setNotice,onQuality:setSpeechQuality});
  const leave=e=>{if(pendingWork()){e.preventDefault();e.returnValue='';}};
  const hide=()=>{if(document.hidden)session.current?.stop();};
  window.addEventListener('beforeunload',leave);document.addEventListener('visibilitychange',hide);
  return()=>{session.current?.dispose();window.removeEventListener('beforeunload',leave);document.removeEventListener('visibilitychange',hide);};
 },[]);
 function download(record){
  const url=URL.createObjectURL(new Blob(['\ufeff'+reportText(record)],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`SIEU_AM_VU_NHAP_${(record.completedAt||deviceStamp()).iso.replace(/[:.]/g,'-')}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  setNotice('Đã xuất phiếu nháp TXT. Lưu file tại nơi đơn vị cho phép.');
 }
 async function complete(){
  if(busy||savingRef.current||s.savedId)return;
  savingRef.current=true;setSaving(true);keepInBrowser();
  try{
   await draftQueue.current.catch(()=>{});
   await saveDraft(draftIdentity.current,s);
   const record=completedRecord(s,draftIdentity.current.id);
   await saveCompletedResult(record,draftIdentity.current);
   dispatch({type:'saved',record});setRecords(current=>[record,...current]);setStorageError('');
   setDraftPhase('idle');setDraftError('');refreshDrafts();
   setNotice('Đã lưu ca vào Kết quả trên thiết bị — chờ bác sĩ kiểm tra. Không cần Internet để mở lại.');setPage('results');
  }catch(e){setNotice('Chưa hoàn thành lưu: '+e.message+' Nội dung ca vẫn được giữ tại màn hình Ghi ca.');}
  finally{savingRef.current=false;setSaving(false);}
 }
 async function preserveDraft(){
  await draftQueue.current.catch(()=>{});
  if(hasDraftContent(sRef.current))return await saveDraft(draftIdentity.current,sRef.current);
 }
 async function retryDraft(){
  setDraftPhase('saving');setSwitching(true);
  try{const draft=await preserveDraft();savedDraftState.current=sRef.current;setDraftAt(draft?.updatedAt||null);setDraftPhase('saved');setDraftError('');}catch(e){setDraftPhase('error');setDraftError(e.message);}finally{setSwitching(false);}
 }
 function resetDraftIdentity(){draftIdentity.current={id:crypto.randomUUID(),owner:crypto.randomUUID()};draftQueue.current=Promise.resolve();savedDraftState.current=null;setDraftPhase('idle');setDraftAt(null);setDraftError('');}
 async function newCase(){
  if(busy||saving||switching)return;
  if(hasDraftContent(s)&&!window.confirm('Giữ ca hiện tại trong Bản nháp và tạo ca mới?'))return;
  setSwitching(true);
  try{await preserveDraft();resetDraftIdentity();dispatch({type:'reset'});setSpeechQuality(null);setPage('record');setNotice('Ca mới. Ca trước chưa hoàn thành vẫn có trong Bản nháp.');await refreshDrafts();}catch(e){setDraftError(e.message);}finally{setSwitching(false);}
 }
 async function recover(id){
  if(busy||saving||switching)return;
  if(hasDraftContent(s)&&!window.confirm('Giữ ca đang nhập trong Bản nháp rồi mở ca đã chọn?'))return;
  setSwitching(true);
  try{await preserveDraft();const owner=crypto.randomUUID(),draft=await restoreDraft(id,owner);draftIdentity.current={id,owner,claimed:true};draftQueue.current=Promise.resolve();dispatch({type:'restore',state:draft.state});setDraftAt(draft.updatedAt);setDraftError('');setPage('record');setNotice('Đã khôi phục ca và giờ bắt đầu từ bản nháp trên thiết bị.');await refreshDrafts();}catch(e){setDraftError(e.message);}finally{setSwitching(false);}
 }
 const phaseLabels={idle:'Micro đang tắt',starting:'Đang mở micro',listening:'● Đang nghe',reconnecting:'Đang nối lại',stopping:'Đang chép nốt âm thanh',error:'Còn âm thanh chưa chép'};
 return <div className={'voice-app'+(window.parent!==window&&new URLSearchParams(location.search).get('embedded')==='1'?' is-embedded':'')}><header className="voice-header"><a href="./" className="voice-brand" onClick={e=>{if(window.parent!==window)e.preventDefault();}}><span className="brand-mark">V</span><span>KHOA VÚ<small>Không gian hỗ trợ thư ký</small></span></a><span className="prototype">GHI KẾT QUẢ · LƯU TRÊN THIẾT BỊ</span><button onClick={newCase} disabled={busy||saving||switching}>Tạo ca mới</button></header>
 <main className="voice-main"><div className="workspace-nav"><nav aria-label="Không gian siêu âm"><button aria-pressed={page==='record'} disabled={busy||saving||switching} onClick={()=>setPage('record')}>Ghi ca</button><button aria-pressed={page==='results'} disabled={busy||saving||switching} onClick={()=>{setPage('results');refreshResults();}}>Kết quả <span className="nav-count">{records.filter(r=>r.status==='pending').length} chờ kiểm tra</span></button></nav><DeviceClock/></div>
 <section className={'offline-status '+(!online?'disconnected':'')} aria-label="Lưu ngoại tuyến"><div><strong>{online?'Lưu ca trong trình duyệt':'Đang ngoại tuyến · dữ liệu lưu trên thiết bị'}</strong><p>{offlineState==='ready'?'Đã lưu tài nguyên để mở trang khi mất kết nối.':offlineState==='preparing'?'Đang chuẩn bị để mở lại trang khi mất kết nối…':offlineError}</p><small>PhoWhisper chạy trên máy, không cần Internet. Giữ CHAY-SPEECH mở khi dùng micro.</small></div><span role="status">{s.savedId?'Ca đã lưu trong Kết quả':draftPhase==='saving'?'Đang tự lưu bản nháp…':draftPhase==='saved'?`Đã lưu nháp: ${showTime(draftAt)}`:draftPhase==='error'?'Chưa lưu được bản nháp':'Tự lưu khi bắt đầu nhập'}</span></section>
 {draftError&&<div className="warning" role="alert">Chưa xác nhận lưu nháp: {draftError} Nội dung trên màn hình chưa bị xóa. <button disabled={locked} onClick={retryDraft}>Thử lưu lại</button></div>}
 <div className="browser-storage-note" role="status">Ca và bản nháp được lưu ngay trong trình duyệt này, không cần chọn thư mục. {persistence==='persistent'?'Đã bật lưu bền vững.':'Trình duyệt chưa bảo đảm chống tự thu hồi dung lượng.'} {persistence!=='persistent'&&<button onClick={keepInBrowser}>Bật lưu bền vững</button>} Không xóa dữ liệu trang hoặc dùng cửa sổ ẩn danh nếu muốn giữ ca để xem lại mỗi ngày. Lưu nội dung bản chép, không lưu tệp âm thanh.</div>
 <details className="draft-recovery"><summary>Bản nháp chưa hoàn thành ({drafts.length})</summary><p className="hint">Chọn đúng PID/mã chỉ định để tiếp tục ca trước. Bản nháp đang mở ở tab khác sẽ chuyển quyền chỉnh sửa sang tab này.</p><button disabled={busy||saving||switching} onClick={refreshDrafts}>Tải lại bản nháp</button>{drafts.map(draft=><button className="draft-row" key={draft.id} disabled={busy||saving||switching} onClick={()=>recover(draft.id)}><strong>{draft.state.patient.name||draft.state.patient.pid||'Ca chưa đủ định danh'}</strong><span>{draft.state.patient.pid||'Chưa có PID'} · {draft.state.patient.order||'Chưa có mã chỉ định'}</span><span>Lưu nháp lúc {showTime(draft.updatedAt)}</span><span>Khôi phục ca này →</span></button>)}</details>
 {page==='results'?<><ResultsPanel onLeaveState={setReviewPending} initialSelectedId={s.savedId} records={records} loading={loading} error={storageError} onReload={refreshResults} onUpdated={next=>setRecords(current=>current.map(r=>r.id===next.id?next:r))} onExport={download} onPrint={setPrintTarget}/><div className="after-results"><button className="primary" disabled={switching} onClick={newCase}>＋ Ghi ca mới</button><span className="hint">Ca đã lưu vẫn ở mục Kết quả để kiểm tra sau.</span></div></>:<><div className="voice-heading"><div><p className="eyebrow">PHÒNG SIÊU ÂM / GHI KẾT QUẢ</p><h1>Ghi kết quả siêu âm</h1><p>Thu lời đọc, kiểm tra nội dung và lưu ca ở trạng thái chờ bác sĩ kiểm tra.</p></div><div className="step-label">01 Thông tin ca <span>→</span> 02 Bắt đầu <span>→</span> 03 Lưu kết quả</div></div>
 <div className="voice-grid"><aside className="voice-card patient-card"><div className="card-heading"><span className="step-no">01</span><h2>Thông tin ca</h2></div><p className="hint">Có thể bổ sung sau khi dừng micro; cần đầy đủ trước khi lưu kết quả.</p><fieldset disabled={locked}>{[['pid','PID *'],['visit','Mã lượt khám *'],['order','Mã chỉ định *'],['name','Họ tên'],['doctor','Bác sĩ đọc *']].map(([key,label])=><label key={key}>{label}<input value={s.patient[key]} onChange={e=>dispatch({type:'patient',key,value:e.target.value})} placeholder={key==='pid'?'Nhập / dán mã người bệnh':'Nhập thông tin'}/></label>)}<label>Phòng thực hiện<select value={s.patient.room} onChange={e=>dispatch({type:'patient',key:'room',value:e.target.value})}><option>Siêu âm vú 1</option><option>Siêu âm vú 2</option><option>Siêu âm 3D</option></select></label></fieldset><div className="memory-note">Ca đang nhập tự lưu Bản nháp trên thiết bị. Hoàn thành ca để đưa vào Kết quả. Cả hai dùng được khi mất mạng. Không lưu âm thanh.</div><div className="case-times"><span>Bắt đầu ghi</span><strong>{showTime(s.startedAt)}</strong><span>Hoàn thành ca</span><strong>{showTime(s.completedAt)}</strong><small>Tự ghi theo đồng hồ thiết bị, không cần nhập ngày giờ.</small></div></aside>
 <section className="voice-card dictation-card"><div className="card-heading"><span className="step-no">02</span><h2>Bản chép lời đọc</h2><span className={'listen-badge '+(phase==='listening'?'live':'')} role="status">{phaseLabels[phase]}</span></div>
 <div className="mic-box natural-mic"><div><h3>{phase==='listening'?'Đang chép lời bác sĩ…':'Ghi lời đọc bằng micro'}</h3><p>Không tự tóm tắt, chia mục hoặc suy ra kết luận.</p></div><button className="primary mic-button" disabled={(phase==='stopping'||phase==='error')||saving||switching||!!s.savedId||(!busy&&!audioSupported)} onClick={()=>{if(busy)session.current?.stop();else{setConsent(true);setSpeechQuality(null);keepInBrowser();dispatch({type:'begin'});session.current?.start();}}}>{phase==='starting'?'Đang mở micro…':phase==='stopping'?'Đang chép nốt…':busy?'■ Dừng':'● Bắt đầu'}</button></div>
 {!audioSupported&&<div className="warning">Trình duyệt này chưa hỗ trợ thu micro. Mở bằng Chrome/Edge tại 127.0.0.1; vẫn có thể gõ vào bản chép.</div>}
 <label className="consent"><input type="checkbox" checked={consent} disabled={locked} onChange={e=>setConsent(e.target.checked)}/><span>Bấm Bắt đầu là đồng ý dùng micro để chép trên máy; trình duyệt sẽ hỏi cấp quyền nếu cần. Âm thanh chỉ giữ tạm trong bộ nhớ, không gửi lên Internet.</span></label>
 {phase==='error'&&<div className="warning" role="alert">Còn đoạn âm thanh chưa chép. Giữ tab này mở.<button onClick={()=>session.current?.retry()}>Thử chép lại</button><button onClick={()=>{if(window.confirm('Bỏ âm thanh chưa chép? Phần này sẽ mất và cần nhập lại bằng tay.'))session.current?.discard();}}>Bỏ đoạn lỗi để nhập tay</button></div>}
 <div className="voice-status" role="status" aria-live="polite">{notice}</div>{speechQuality&&<div className="warning speech-quality-badge" role="alert"><div><strong>Cần soát đoạn nhận dạng ({speechQuality.level})</strong>{speechQuality.confidence!==null&&speechQuality.confidence!==undefined&&<span> · Độ tin cậy: {Math.round(speechQuality.confidence*100)}%</span>}{speechQuality.accentRegion&&<span> · Giọng: Miền {speechQuality.accentRegion}</span>}: {speechQuality.reason}</div>{speechQuality.corrections?.length>0&&<div className="speech-diff"><small>Đối chiếu nhanh: {speechQuality.corrections.join(' | ')}</small>{speechQuality.rawText&&<div><small>Bản gốc: “{speechQuality.rawText}”</small></div>}</div>}<div className="speech-quality-actions"><button type="button" onClick={()=>setSpeechQuality(null)}>✓ Xác nhận đúng</button>{speechQuality.rawText&&speechQuality.text&&<button type="button" onClick={()=>{dispatch({type:'edit',value:s.transcript.replace(speechQuality.text,speechQuality.rawText)});setSpeechQuality(null);}}>↶ Khôi phục bản gốc</button>}</div></div>}{s.savedId&&<p className="ready">Ca đã được lưu. Mở Kết quả để bác sĩ kiểm tra; tạo ca mới để ghi tiếp.</p>}
 <label className="transcript-label">Nội dung bản chép<textarea className="full-transcript" aria-label="Nội dung bản chép" rows={18} ref={transcriptBox} value={visibleTranscript} readOnly={locked} aria-busy={busy} onChange={e=>dispatch({type:'edit',value:e.target.value})} placeholder="Toàn bộ lời bác sĩ sẽ xuất hiện tại đây. Có thể đọc liên tục về vú phải, vú trái, hạch nách và kết luận trong cùng một lượt…"/></label>
 {interim&&<div className="interim" aria-live="polite">Đang viết theo lời đọc · đoạn cuối chưa chốt, sẽ cập nhật khi bạn đọc tiếp.</div>}
 <div className="transcript-tools"><span className="hint">{s.transcript.trim()?s.transcript.trim().split(/\s+/u).length:0} từ · Dừng để sửa và soát lời đọc.</span><button disabled={locked||!s.history.length} onClick={()=>dispatch({type:'undo'})}>↶ Hoàn tác</button></div>
 <details className="source-words"><summary>Lời nhận dạng gốc để đối chiếu</summary><p className="hint">Giữ từng đoạn dịch vụ đã nhận dạng, kể cả khi sửa bản chép. Đây là văn bản nhận dạng, không phải bản ghi âm.</p>{s.events.filter(e=>e.source==='Lời đọc').map((e,i)=><p key={i}>{e.text}</p>)}{!s.events.some(e=>e.source==='Lời đọc')&&<p className="hint">Chưa có đoạn nhận dạng từ micro.</p>}</details>
 </section>
 <aside className="voice-side"><section className="voice-card review"><div className="card-heading"><span className="step-no">03</span><h2>Hoàn thành ca</h2></div><p>Thư ký soát 4 điểm dễ nhầm: <strong>bên vú · số đo và đơn vị · từ phủ định · BI-RADS.</strong></p><p className="hint">Nghe không rõ thì xác minh với bác sĩ. Giữ lời tự sửa trong bản chép để đối chiếu; không tự chọn câu nào đúng.</p>{issues.length>0?<p className="warning">Cần bổ sung: {issues.join(', ')}.</p>:<p className="ready">Có nội dung để soát.</p>}<label className="consent"><input type="checkbox" checked={s.reviewed} disabled={locked||issues.length>0} onChange={e=>dispatch({type:'review',value:e.target.checked})}/><span>Thư ký đã soát bản chép (không bắt buộc để lưu ca). Bác sĩ sẽ kiểm tra sau.</span></label>{s.transcriptionCheckedAt&&<p className="hint">Thư ký soát lúc: {showTime(s.transcriptionCheckedAt)}</p>}<button className="primary" disabled={locked||issues.length>0} onClick={complete}>{saving?'Đang lưu…':s.savedId?'Đã lưu kết quả':'✓ Hoàn thành & lưu kết quả'}</button><p className="hint">Lưu ở trạng thái Đã có kết quả · Chờ bác sĩ kiểm tra. Ngày giờ hoàn thành tự ghi khi bấm nút.</p><button disabled={busy||saving||switching||!s.transcript.trim()} onClick={()=>download(s)}>↓ Xuất phiếu nháp (.txt)</button><button disabled={busy||saving||switching||!s.transcript.trim()} onClick={()=>setPrintTarget(s)}>In / lưu PDF bản nháp</button><button className="danger" disabled={busy||saving||switching} onClick={newCase}>Tạo ca mới</button></section><div className="memory-note">Đặt micro gần bác sĩ, hạn chế người nói xen. Hệ thống có thể chép cả tiếng nói xung quanh và chưa phân biệt người nói.</div></aside></div></>}
 <footer>Vú Voice · Bác sĩ kiểm tra nội dung trước khi sử dụng. Kết quả lưu trên thiết bị này, chưa đồng bộ HIS/EMR.</footer></main><section className="print-report"><pre>{reportText(printTarget||s)}</pre></section></div>;
}
createRoot(document.getElementById('root')).render(<SpeechApp/>);
