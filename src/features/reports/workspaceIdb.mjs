const DB_NAME='vinmec-workspace-db',STORE='workspaces',KEY='vinmec-demo-v1';
function openDb(){
 if(typeof indexedDB==='undefined')return Promise.resolve(null);
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('Không mở được IndexedDB kho dữ liệu.'));
 });
}
export async function readWorkspaceIdb(){
 const db=await openDb();if(!db)return null;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(KEY);
  req.onsuccess=()=>resolve(req.result||null);
  req.onerror=()=>reject(req.error||Error('Không đọc được kho dữ liệu từ IndexedDB.'));
 });
}
export async function writeWorkspaceIdb(state){
 const db=await openDb();if(!db)return false;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');
  tx.objectStore(STORE).put(state,KEY);
  tx.oncomplete=()=>resolve(true);
  tx.onerror=()=>reject(tx.error||Error('Không lưu được kho dữ liệu vào IndexedDB.'));
 });
}
