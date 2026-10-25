import {readStoredAsset,storeAsset,blobCacheName} from './storage.mjs';
// Local imports are scoped to this Pages project, not other projects on the origin.
export const siteRoot=new URL('../',import.meta.url);
export const libraryCache='rhf-library:'+siteRoot.pathname;
const libraryURL=new URL('local-library.json',siteRoot).href;
let readingLibrary;
export function readLibrary(){
 // A game loads many assets in parallel; share the metadata read for that batch.
 if(!readingLibrary)readingLibrary=(async()=>{
  const response=await(await caches.open(libraryCache)).match(libraryURL);
  return response?response.json():{games:{}};
 })().finally(()=>{readingLibrary=null;});
 return readingLibrary;
}
export async function writeLibrary(library){
 await (await caches.open(libraryCache)).put(libraryURL,new Response(JSON.stringify(library),{headers:{'content-type':'application/json'}}));readingLibrary=null;
}
let libraryQueue=Promise.resolve();
export function withLibraryLock(fn){
 if(globalThis.navigator?.locks)return navigator.locks.request('rhf-library:'+siteRoot.pathname,fn);
 const task=libraryQueue.then(fn,fn);libraryQueue=task.catch(()=>{});return task;
}
export function updateLibrary(change){return withLibraryLock(async()=>{const library=await readLibrary();await change(library);await writeLibrary(library);return library;});}
export function withStorageLock(fn){
 if(globalThis.navigator?.locks)return navigator.locks.request('rhf-asset-storage:'+siteRoot.pathname,fn);
 return fn();
}
export async function storageSummary(){
 const library=await readLibrary();let bytes=0,rawBytes=0;const shared=new Map();
 for(const entry of Object.values(library.games)){
  rawBytes+=entry.rawBytes||entry.bytes||0;
  if(entry.blobs)for(const [hash,size] of Object.entries(entry.blobs))shared.set(hash,size);
  else bytes+=entry.bytes||0;
 }
 for(const size of shared.values())bytes+=size;
 return {bytes,rawBytes,savedBytes:rawBytes-bytes};
}
export async function compactAssets(onprogress=()=>{}){return withStorageLock(async()=>{
 const library=await readLibrary();
 for(const [id,entry] of Object.entries(library.games)){
  if(!entry.cache?.startsWith('rhf-assets:'+siteRoot.pathname+':'))continue;
  onprogress('Compressing saved '+id+' data…');const cache=await caches.open(entry.cache);let gameBytes=0,gameRaw=0;const blobs={};
  for(const request of await cache.keys()){
   const original=await cache.match(request),data=await readStoredAsset(original),size=await storeAsset(cache,request,data);
   gameBytes+=size.bytes;gameRaw+=size.rawBytes;blobs[size.hash]=size.bytes;
  }
  await updateLibrary(l=>{if(l.games[id]?.cache===entry.cache)Object.assign(l.games[id],{bytes:gameBytes,rawBytes:gameRaw,blobs,storage:'shared-gzip-v1'});});
 }
 // All current entries now carry complete reference maps. Under the storage lock,
 // unreferenced blobs can only belong to replaced or interrupted imports.
 const current=await readLibrary(),used=new Set(Object.values(current.games).flatMap(g=>Object.keys(g.blobs||{}))),blobs=await caches.open(blobCacheName);
 for(const request of await blobs.keys())if(!used.has(new URL(request.url).pathname.split('/').at(-1)))await blobs.delete(request);
 const summary=await storageSummary();await updateLibrary(l=>{l.storage=summary;});return summary;
 });}
export async function deployment(){
 const r=await fetch(new URL('deployment.json',siteRoot));
 if(!r.ok)throw new Error('Cannot read deployment information. Reload the page.');
 return r.json();
}
export async function assetResponse(url){
 const key=new URL(url),relative=key.pathname.slice(siteRoot.pathname.length),id=relative.split('/')[0];
 if(typeof caches!=='undefined'&&key.origin===siteRoot.origin&&key.pathname.startsWith(siteRoot.pathname)&&relative.split('/')[1]==='assets'){
  const entry=(await readLibrary()).games[id];
  if(entry){
   const response=await (await caches.open(entry.cache)).match(key.href);
   if(response)return readStoredAsset(response);
   throw new Error('Local game data is incomplete. Return to the library and import your ISO again.');
  }
 }
 const response=await fetch(url);
 if(!response.ok)throw new Error('Game data is missing. Return to the library and import your ISO.');
 return response;
}
export async function assetBytes(url){return new Uint8Array(await (await assetResponse(url)).arrayBuffer());}
export async function assetImage(url){
 const objectURL=URL.createObjectURL(await (await assetResponse(url)).blob());
 try{const i=new Image();i.src=objectURL;await i.decode();return i;}finally{URL.revokeObjectURL(objectURL);}
}
export async function requireAssets(id,onprogress=()=>{}){
 const r=await fetch(new URL('deployment.json',siteRoot));
 if(r.status===404)return; // Ordinary local builds already contain assets.
 if(!r.ok)throw new Error('Cannot check the runtime version. Reload the page.');
 const build=await r.json(),entry=(await readLibrary()).games[id];
 if(entry?.version===(build.assetVersion||build.version)&&await(await caches.open(entry.cache)).match(new URL(id+'/assets/original-timeline.json',siteRoot)))return;
 const {prepareGame}=await import('../import/client.mjs');
 await prepareGame(id,{build,onprogress});
}
