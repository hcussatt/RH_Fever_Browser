import {siteRoot,readLibrary} from '../engine/assets.mjs';
import {requireDisc} from './disc.mjs';
export function runImport(data,onprogress=()=>{}){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('worker.mjs',import.meta.url),{type:'module'});
  const stop=()=>worker.terminate();
  const finish=(error,value)=>{stop();removeEventListener('pagehide',stop);error?reject(error):resolve(value);};
  addEventListener('pagehide',stop,{once:true});
  worker.onmessage=({data})=>{if(data.type==='error')finish(new Error(data.message));else if(data.type==='done')finish(null,data);else onprogress(data);};
  worker.onerror=e=>finish(new Error(e.message||'The importer stopped. Try again.'));
  worker.postMessage(data);
 });
}
export async function prepareGame(id,{build,onprogress=()=>{}}){
 const version=build.assetVersion||build.version;
 const prepare=async()=>{
  const entry=(await readLibrary()).games[id];
  if(entry?.version===version&&await(await caches.open(entry.cache)).match(new URL(id+'/assets/original-timeline.json',siteRoot)))return;
  onprogress('Select your disc to prepare this game…');const file=await requireDisc();
  const games=await(await fetch(new URL('games.json',siteRoot))).json(),game=games.find(g=>g.id===id);
  if(!game)throw new Error('This game is not available in this deployment.');
  await runImport({mode:'game',file,version,games:[game]},data=>{if(data.type==='progress')onprogress(data.message);});
 };
 // Concurrent tabs requesting one game share the completed cache, not two extractions.
 if(navigator.locks)return navigator.locks.request('rhf-extract:'+siteRoot.pathname+':'+id,prepare);
 return prepare();
}
