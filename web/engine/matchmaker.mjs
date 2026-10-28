// Room codes for the multiplayer lobby: the matchmaker (matchmaker/worker.mjs) passes the invite and
// answer between the two browsers, so players share a six-letter code instead of pasting both.
// Empty turns room codes off; the manual codes keep working either way.
export const MATCHMAKER_URL='';
const ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789',LENGTH=6;
// Accepts a room link (#room=…) or the code typed in any case, with spaces or dashes.
export function normalizeRoom(text){
 text=String(text).trim();const hash=text.indexOf('#room=');if(hash>=0)text=text.slice(hash+6);
 const code=text.toUpperCase().replace(/[\s-]/g,'');
 if(code.length!==LENGTH||[...code].some(c=>!ALPHABET.includes(c)))throw new Error('Room codes are six letters and numbers. Check the code and try again.');
 return code;
}
async function call(base,path,options,fetchFn){
 let r;try{r=await fetchFn(new URL(path,base),{cache:'no-store',...options});}catch{throw new Error('Cannot reach the matchmaker. Use the copy-paste codes below instead.');}
 return r;
}
export async function openRoom(offer,{base=MATCHMAKER_URL,fetchFn=fetch}={}){
 const r=await call(base,'rooms',{method:'POST',body:offer},fetchFn);
 if(r.status!==201)throw new Error('Could not create a room. Use the copy-paste codes below instead.');
 return normalizeRoom((await r.json()).code);
}
export async function readOffer(code,{base=MATCHMAKER_URL,fetchFn=fetch}={}){
 const r=await call(base,`rooms/${normalizeRoom(code)}/offer`,{},fetchFn);
 if(r.status===404)throw new Error('No room with that code. It may have expired; ask your friend for a new one.');
 if(!r.ok)throw new Error('Could not open the room. Try again.');
 return r.text();
}
export async function sendAnswer(code,answer,{base=MATCHMAKER_URL,fetchFn=fetch}={}){
 const r=await call(base,`rooms/${normalizeRoom(code)}/answer`,{method:'PUT',body:answer},fetchFn);
 if(r.status===409)throw new Error('Someone already joined this room. Ask your friend for a new one.');
 if(r.status!==201)throw new Error('Could not join the room. It may have expired; ask your friend for a new one.');
}
// Resolves with the guest's answer. Rooms last ten minutes on the matchmaker.
export async function waitForAnswer(code,{base=MATCHMAKER_URL,fetchFn=fetch,signal,interval=1500,timeout=10*60*1000}={}){
 const until=Date.now()+timeout;
 while(!signal?.aborted){
  const r=await call(base,`rooms/${normalizeRoom(code)}/answer`,{signal},fetchFn).catch(e=>{if(signal?.aborted)return null;throw e;});
  if(!r||signal?.aborted)break;
  if(r.status===200)return r.text();
  if(r.status!==204||Date.now()>until)throw new Error('The room expired. Create a new one.');
  await new Promise(resolve=>setTimeout(resolve,interval));
 }
 throw new Error('Stopped waiting for the room.');
}
