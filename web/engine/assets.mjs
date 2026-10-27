// Local imports are scoped to this Pages project, not other projects on the origin.
export const siteRoot=new URL('../',import.meta.url);
export const libraryCache='rhf-library:'+siteRoot.pathname;
const libraryURL=new URL('local-library.json',siteRoot).href;
export async function readLibrary(){
 const response=await (await caches.open(libraryCache)).match(libraryURL);
 return response?response.json():{games:{}};
}
export async function writeLibrary(library){
 await (await caches.open(libraryCache)).put(libraryURL,new Response(JSON.stringify(library),{headers:{'content-type':'application/json'}}));
}
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
   if(response)return response;
   throw new Error('Local game data is incomplete. Return to the library and import your ISO again.');
  }
 }
 const response=await fetch(url);
 if(!response.ok)throw new Error('Game data is missing. Return to the library and import your ISO.');
 return response;
}
export async function assetBytes(url){return new Uint8Array(await (await assetResponse(url)).arrayBuffer());}
// Images decode a few at a time: Remix 10's 30 scenes start hundreds of decodes at once, and
// Chrome then fails some of them ("The source image cannot be decoded").
let decoding=0;const waiting=[];
export async function assetImage(url){
 const blob=await (await assetResponse(url)).blob();
 if(decoding>=8)await new Promise(resolve=>waiting.push(resolve));
 decoding++;const objectURL=URL.createObjectURL(blob);
 try{const i=new Image();i.src=objectURL;await i.decode();return i;}
 finally{URL.revokeObjectURL(objectURL);decoding--;waiting.shift()?.();}
}
export async function requireAssets(id){
 const r=await fetch(new URL('deployment.json',siteRoot));
 if(r.status===404)return; // Existing local dist/ builds use ordinary asset files.
 if(!r.ok)throw new Error('Cannot check the runtime version. Reload the page.');
 const build=await r.json(),entry=(await readLibrary()).games[id];
 if(!entry||entry.version!==(build.assetVersion||build.version))throw new Error('Import your ISO from the library to prepare data for this runtime version.');
}
