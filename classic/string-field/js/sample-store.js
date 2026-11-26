// Local imported audio survives a complete-build update. No upload endpoint.
const DATABASE='string-field-audio-v1', STORE='samples';
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DATABASE,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function readLocalSample(id){const db=await open();try{return await new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}finally{db.close();}}
export async function saveLocalSample(file){
 if(!file||file.size>20*1024*1024)throw Error('Choose an audio file under 20 MB');
 const bytes=await file.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',bytes);
 const id='local-'+Array.from(new Uint8Array(hash)).slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('');
 const item={id,name:file.name.slice(0,120),blob:new Blob([bytes],{type:file.type||'application/octet-stream'}),createdAt:Date.now()};
 const db=await open();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),r=store.getAll();r.onsuccess=()=>{const items=r.result.filter(s=>s.id!==id).sort((a,b)=>a.createdAt-b.createdAt);while(items.length>=4)store.delete(items.shift().id);store.put(item);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}return item;
}
