// Private developer file host (docs/dev-host.md). It serves game files the owner prepared from
// his own disc to a browser that presents DEV_KEY, and takes uploads only with UPLOAD_KEY. Both
// keys are Worker secrets; without them every request is refused. Files are stored in R2 by their
// SHA-256, so games that share a file store it once and an upload skips what is already there.
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
  if(!env.DEV_KEY||!env.UPLOAD_KEY||!env.FILES)return reply('Dev host is not configured',503);
  const key=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
  const upload=!origin&&await same(key,env.UPLOAD_KEY);
  if(!upload&&!await same(key,env.DEV_KEY))return reply('Wrong dev key',401);
  const parts=new URL(request.url).pathname.split('/').filter(Boolean);
  const name=parts.length===1&&parts[0]==='manifest.json'?'manifest.json':parts.length===2&&parts[0]==='files'&&HASH.test(parts[1])?'files/'+parts[1]:null;
  if(!name)return reply('Not found',404);
  if(request.method==='GET'||request.method==='HEAD'){
   const object=await env.FILES.get(name);
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
  await env.FILES.put(name,body,{httpMetadata:{contentType:request.headers.get('content-type')||'application/octet-stream'}});
  return reply(null,201);
 }
};
