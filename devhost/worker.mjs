// Private developer file host (docs/dev-host.md). It serves game files the owner prepared from
// his own disc to a browser that presents DEV_KEY, and takes uploads only with UPLOAD_KEY. Both
// keys are Worker secrets; without them every request is refused. Files are stored in R2 by their
// SHA-256, so games that share a file store it once and an upload skips what is already there.
// Usage stops at 80% of R2's free monthly allowance (Usage below), so it never costs money.
// Nothing here is public: anyone holding DEV_KEY gets the files, so it must stay private.
const LOCAL=/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,HASH=/^[0-9a-f]{64}$/,MAX_MANIFEST=4<<20;
function allowed(origin,env){return !!origin&&(LOCAL.test(origin)||(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).includes(origin));}
// Compares digests of the two strings, so the time taken says nothing about the key.
async function same(given,secret){
 if(!given||!secret)return false;
 const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [a,b]=await Promise.all([digest(given),digest(secret)]);
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
// R2's free plan each month: 10 GB stored, 1 million writes (class A), 10 million reads
// (class B). The Worker stops at CAP of each, so the owner is never charged.
export const CAP=.8,FREE={bytes:10e9,writes:1e6,reads:10e6};
export const LIMITS={bytes:CAP*FREE.bytes,writes:CAP*FREE.writes,reads:CAP*FREE.reads};
const month=(now=new Date())=>now.toISOString().slice(0,7);
// One Durable Object keeps the counts. They stay in memory and are saved every FLUSH
// operations (and by an alarm), so counting costs a small fraction of a storage write per request.
const FLUSH=25;
export class Usage {
 constructor(state,env){this.storage=state.storage;this.env=env;this.pending=0;}
 load(){return this.loading??=this.read();}
 async read(){
  this.usage=await this.storage.get('usage');
  if(!this.usage){
   // First run: count what the bucket already holds (one list call per 1000 objects).
   let bytes=0,cursor,writes=0;
   do{const page=await this.env.FILES.list({cursor,limit:1000});writes++;for(const o of page.objects)bytes+=o.size;cursor=page.truncated?page.cursor:undefined;}while(cursor);
   this.usage={month:month(),reads:0,writes,bytes};
   await this.storage.put('usage',this.usage);
  }
  return this.usage;
 }
 async fetch(request){
  const {kind,bytes=0}=await request.json(),u=await this.load();
  if(u.month!==month())Object.assign(u,{month:month(),reads:0,writes:0});
  // Deleting is free and gives the stored size back.
  if(kind==='freed'){u.bytes=Math.max(0,u.bytes-bytes);await this.storage.put('usage',u);return Response.json({ok:true,usage:u});}
  if(kind==='read'&&u.reads+1>LIMITS.reads||kind==='write'&&(u.writes+1>LIMITS.writes||u.bytes+bytes>LIMITS.bytes))
   return Response.json({ok:false,usage:u});
  if(kind==='read')u.reads++;else{u.writes++;u.bytes+=bytes;}
  // Writes are rare and decide the stored size, so they are saved at once.
  if(kind==='write'||++this.pending>=FLUSH){this.pending=0;await this.storage.put('usage',u);}
  else if(this.pending===1)await this.storage.setAlarm(Date.now()+10000);
  return Response.json({ok:true,usage:u});
 }
 async alarm(){if(this.usage){this.pending=0;await this.storage.put('usage',this.usage);}}
}
// Asks the counter before each R2 operation. False once that operation would pass the cap.
async function allow(env,kind,bytes=0){
 const counter=env.USAGE.get(env.USAGE.idFromName('r2'));
 return (await (await counter.fetch('https://usage/',{method:'POST',body:JSON.stringify({kind,bytes})})).json()).ok;
}
const LIMIT_REACHED='The dev host reached 80% of its free monthly allowance and is paused until next month, so nothing is charged.';
// Files no manifest game lists any more (left by earlier uploads). With remove, deletes them.
// Listing costs one write per 1000 objects; deleting is free.
async function unused(env,remove){
 const manifest=await env.FILES.get('manifest.json');
 if(!manifest)return {error:'No manifest yet; nothing is cleaned up without one.'};
 const keep=new Set(Object.values((await manifest.json()).games).flatMap(g=>Object.values(g.files)).map(d=>'files/'+d));
 const found=[];let cursor,bytes=0;
 do{
  if(!await allow(env,'write'))return {error:LIMIT_REACHED};
  const page=await env.FILES.list({prefix:'files/',cursor,limit:1000});
  for(const o of page.objects)if(!keep.has(o.key)){found.push(o.key);bytes+=o.size;}
  cursor=page.truncated?page.cursor:undefined;
 }while(cursor);
 if(remove){
  for(let i=0;i<found.length;i+=1000)await env.FILES.delete(found.slice(i,i+1000));
  await allow(env,'freed',bytes);
 }
 return {count:found.length,bytes,kept:keep.size};
}
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
export default {
 async fetch(request,env){
  const origin=request.headers.get('origin');
  // Browsers send an origin; the upload tool sends none and must hold the upload key.
  if(origin&&!allowed(origin,env))return new Response('Forbidden',{status:403});
  const headers={'cache-control':'private, no-store',vary:'origin'};
  if(origin)Object.assign(headers,{'access-control-allow-origin':origin,'access-control-allow-methods':'GET, HEAD','access-control-allow-headers':'authorization','access-control-max-age':'86400'});
  const reply=(body,status=200,extra={})=>new Response(body,{status,headers:{...headers,...extra}});
  if(request.method==='OPTIONS')return reply(null,204);
  if(!env.DEV_KEY||!env.UPLOAD_KEY||!env.FILES||!env.USAGE)return reply('Dev host is not configured',503);
  const key=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
  const upload=!origin&&await same(key,env.UPLOAD_KEY);
  if(!upload&&!await same(key,env.DEV_KEY))return reply('Wrong dev key',401);
  const parts=new URL(request.url).pathname.split('/').filter(Boolean);
  // GET /prune previews, POST /prune deletes; only the upload tool can do either.
  if(parts.length===1&&parts[0]==='prune'){
   if(!upload||!['GET','POST'].includes(request.method))return reply(null,405);
   const result=await unused(env,request.method==='POST');
   return result.error?reply(result.error,result.error===LIMIT_REACHED?507:409):Response.json(result,{headers});
  }
  const name=parts.length===1&&parts[0]==='manifest.json'?'manifest.json':parts.length===2&&parts[0]==='files'&&HASH.test(parts[1])?'files/'+parts[1]:null;
  if(!name)return reply('Not found',404);
  if(request.method==='GET'||request.method==='HEAD'){
   if(!await allow(env,'read'))return reply(LIMIT_REACHED,503);
   const object=request.method==='HEAD'?await env.FILES.head(name):await env.FILES.get(name);
   if(!object)return reply('Not found',404);
   const type={'content-type':object.httpMetadata?.contentType||'application/octet-stream','content-length':String(object.size)};
   return reply(request.method==='HEAD'?null:object.body,200,type);
  }
  if(request.method!=='PUT'||!upload)return reply(null,405);
  const body=await request.arrayBuffer();
  if(name==='manifest.json'){
   if(body.byteLength>MAX_MANIFEST)return reply('Manifest too large',413);
   try{const m=JSON.parse(new TextDecoder().decode(body));if(!m||typeof m.games!=='object')throw 0;}catch{return reply('Invalid manifest',400);}
  }else if(hex(await crypto.subtle.digest('SHA-256',body))!==parts[1])return reply('Checksum mismatch',400);
  if(!await allow(env,'write',name==='manifest.json'?0:body.byteLength))return reply(LIMIT_REACHED,507);
  await env.FILES.put(name,body,{httpMetadata:{contentType:request.headers.get('content-type')||'application/octet-stream'}});
  return reply(null,201);
 }
};
