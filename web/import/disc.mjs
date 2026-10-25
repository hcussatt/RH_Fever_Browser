import {siteRoot} from '../engine/assets.mjs';
let sessionFile;
const database='rhf-disc:'+siteRoot.pathname;
async function handleStore(action,value){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(database,1);r.onupgradeneeded=()=>r.result.createObjectStore('source');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('source',action==='get'?'readonly':'readwrite'),store=tx.objectStore('source');
  const r=action==='get'?store.get('disc'):action==='forget'?store.delete('disc'):store.put(value,'disc');
  tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}
export async function validateDisc(file){
 if(file?.size!==4699979776)throw new Error('Select the raw USA ISO (4,699,979,776 bytes).');
 if(new TextDecoder().decode(await file.slice(0,6).arrayBuffer())!=='SOME01')throw new Error('This disc is not Rhythm Heaven Fever USA (SOME01).');
 return file;
}
export async function rememberDisc(file,handle){
 await validateDisc(file);sessionFile=file;
 // Store only the small handle, never the File/Blob or ISO bytes in IndexedDB.
 if(handle)try{await handleStore('set',handle);}catch(e){console.warn('Disc access is available for this tab only.',e);}
 if(typeof window!=='undefined')window.rhfDiscFile=()=>sessionFile;
 return file;
}
export async function availableDisc(){
 if(sessionFile)return sessionFile;
 try{if(window.parent!==window){const file=window.parent.rhfDiscFile?.();if(file)return file;}}catch{}
 try{const handle=await handleStore('get');if(handle&&await handle.queryPermission({mode:'read'})==='granted')return sessionFile=await handle.getFile();}catch{}
 return null;
}
export async function chooseDisc(){
 // Called directly by a button gesture, before other async work.
 const [handle]=await showOpenFilePicker({multiple:false,types:[{description:'USA Wii ISO',accept:{'application/octet-stream':['.iso']}}]});
 return rememberDisc(await handle.getFile(),handle);
}
export async function forgetDisc(){sessionFile=null;await handleStore('forget');}
export async function requireDisc(){
 const existing=await availableDisc();if(existing)return existing;
 return new Promise(resolve=>{
  const box=document.createElement('section');box.id='disc-required';
  box.innerHTML='<p>Select your USA disc to prepare this game. The disc stays on your computer.</p><input type="file" accept=".iso" aria-label="Your disc image"><button type="button">Choose disc</button><p role="status"></p><p><a href="../" target="_top">Back to arcade</a></p>';
  (document.querySelector('#overlay')||document.body).append(box);
  const status=box.querySelector('[role=status]'),input=box.querySelector('input'),button=box.querySelector('button');
  const accept=async get=>{try{const file=await get();box.remove();resolve(file);}catch(e){if(e.name!=='AbortError')status.textContent=e.message;}};
  input.onchange=()=>{if(input.files[0])accept(()=>rememberDisc(input.files[0]));};
  button.hidden=typeof showOpenFilePicker!=='function';button.onclick=()=>accept(chooseDisc);
 });
}
