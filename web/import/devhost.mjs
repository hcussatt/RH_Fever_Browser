// The owner's private dev host (docs/dev-host.md): with the dev key, a browser downloads the game
// files he prepared from his own disc instead of importing an ISO. The key arrives once through a
// dev link (#dev=<key>; the part after # never reaches a server) and stays in this browser only.
import {siteRoot,readLibrary,writeLibrary} from '../engine/assets.mjs';
export const DEV_HOST_URL='https://rhf-devhost.hcussatt.workers.dev/';
const STORE='rhf-dev-key';
const mime=name=>name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'application/octet-stream';
export function devKey(){try{return localStorage.getItem(STORE)||'';}catch{return '';}}
export function forgetDevKey(){try{localStorage.removeItem(STORE);}catch{}}
// Takes the key out of a dev link and the address bar. True when the link carried one.
export function takeDevLink(location=globalThis.location,history=globalThis.history){
 const key=new URLSearchParams(location.hash.slice(1)).get('dev');
 if(!key)return false;
 try{localStorage.setItem(STORE,key);}catch{}
 history.replaceState(null,'',location.pathname+location.search);
 return true;
}
async function get(path,key,fetchFn){
 const r=await fetchFn(new URL(path,DEV_HOST_URL),{headers:{authorization:'Bearer '+key}});
 if(r.status===401)throw new Error('The dev host did not accept this dev key.');
 if(r.status===404&&path==='manifest.json')throw new Error('The dev host has no files yet. Run tools/dev-host-upload.py on the Mac.');
 if(!r.ok)throw new Error('The dev host is unavailable ('+r.status+').');
 return r;
}
// The Wii common key the upload tool stored with the files (the site no longer includes it).
export async function devCommonKey({key=devKey(),fetchFn=fetch}={}){
 if(!key)throw new Error('Open your dev link first.');
 const {wiiCommonKey}=await (await get('manifest.json',key,fetchFn)).json();
 if(!wiiCommonKey)throw new Error('The dev host has no Wii common key. Run tools/dev-host-upload.py on the Mac again.');
 return wiiCommonKey;
}
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
// Stores each game exactly as an ISO import would (web/import/worker.mjs): one cache per game,
// and the library pointer only once every file of that game is in place and checked.
export async function installFromDevHost({build,games,key=devKey(),progress=()=>{},onGame=()=>{},signal,fetchFn=fetch}){
 if(!key)throw new Error('Open your dev link first.');
 const manifest=await (await get('manifest.json',key,fetchFn)).json();
 if(build.importVersion&&manifest.importVersion!==build.importVersion)
  throw new Error(`The dev host's files (commit ${manifest.commit||'?'}, ${manifest.uploadedAt||'unknown date'}) were made by a different converter version than this site. Rebuild on the Mac from this version and run tools/dev-host-upload.py again.`);
 const version=build.assetVersion||build.version;
 for(const {id,title} of games){
  const entry=manifest.games[id];
  if(!entry){progress(title+' is not on the dev host; skipped.');continue;}
  // A game already downloaded from these same files for this runtime is kept.
  const files=Object.entries(entry.files),fingerprint=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(files))));
  const current=(await readLibrary()).games[id];
  if(current?.version===version&&current.devFiles===fingerprint){await onGame(id,title);continue;}
  const name='rhf-assets:'+siteRoot.pathname+':'+version+':'+id+':'+crypto.randomUUID();
  const cache=await caches.open(name),base=new URL(id+'/',siteRoot);
  let done=0,bytes=0;
  try{
   const next=files.entries();
   const worker=async()=>{
    for(const [,[file,digest]] of next){
     if(signal?.aborted)throw new Error('Download canceled. Any games already downloaded remain available.');
     const data=await (await get('files/'+digest,key,fetchFn)).arrayBuffer();
     if(hex(await crypto.subtle.digest('SHA-256',data))!==digest)throw new Error(title+': '+file+' arrived damaged. Try again.');
     await cache.put(new URL('assets/'+file,base),new Response(data,{headers:{'content-type':mime(file)}}));
     bytes+=data.byteLength;progress(`Downloading ${title}… ${++done}/${files.length}`);
    }
   };
   await Promise.all(Array.from({length:6},worker));
   const library=await readLibrary(),previous=library.games[id];
   library.games[id]={cache:name,version,bytes,importedAt:new Date().toISOString(),devFiles:fingerprint};
   await writeLibrary(library);
   if(previous?.cache&&previous.cache!==name)await caches.delete(previous.cache);
  }catch(e){await caches.delete(name);throw e;}
  await onGame(id,title);
 }
}
