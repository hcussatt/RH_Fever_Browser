import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../devhost/worker.mjs';
import {installFromDevHost,takeDevLink,devKey,forgetDevKey,devCommonKey,DEV_HOST_URL} from '../web/import/devhost.mjs';
import {checkCommonKey,keyDigits} from '../web/import/wii-key.mjs';
import {readLibrary} from '../web/engine/assets.mjs';
const sha=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof data==='string'?new TextEncoder().encode(data):data))].map(b=>b.toString(16).padStart(2,'0')).join('');
// In-memory stand-ins for the R2 bucket, Cache Storage and localStorage.
function bucket(){const data=new Map();return {data,async get(k){const v=data.get(k);return v&&{body:v.body,size:v.body.byteLength,httpMetadata:v.meta};},async put(k,body,o){data.set(k,{body:new Uint8Array(body),meta:o.httpMetadata});}};}
const env=()=>({DEV_KEY:'dev-secret',UPLOAD_KEY:'upload-secret',ALLOWED_ORIGINS:'https://hcussatt.github.io',FILES:bucket()});
const call=(e,path,{method='GET',key,origin='https://hcussatt.github.io',body,type}={})=>{
 const headers={};if(origin)headers.origin=origin;if(key)headers.authorization='Bearer '+key;if(type)headers['content-type']=type;
 return worker.fetch(new Request('https://devhost.example/'+path,{method,headers,body}),e);
};
globalThis.caches??=(()=>{const all=new Map();return {all,async open(n){if(!all.has(n))all.set(n,new Map());const c=all.get(n);return {async match(u){return c.get(String(u))?.clone();},async put(u,r){c.set(String(u),r);}};},async delete(n){return all.delete(n);},async keys(){return [...all.keys()];}};})();
globalThis.localStorage??=(()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};})();

test('the dev host refuses everything without its secrets or the right key',async()=>{
 const e=env();
 assert.equal((await call({...e,DEV_KEY:''},'manifest.json',{key:''})).status,503);
 assert.equal((await call(e,'manifest.json')).status,401);
 assert.equal((await call(e,'manifest.json',{key:'dev-secre'})).status,401);
 assert.equal((await call(e,'manifest.json',{key:'dev-secret',origin:'https://evil.example'})).status,403);
 assert.equal((await call(e,'manifest.json',{key:'dev-secret'})).status,404);
 assert.equal((await call(e,'../secrets',{key:'dev-secret'})).status,404);
 const preflight=await call(e,'manifest.json',{method:'OPTIONS'});
 assert.equal(preflight.headers.get('access-control-allow-origin'),'https://hcussatt.github.io');
 assert.match(preflight.headers.get('access-control-allow-headers'),/authorization/);
});
test('only the upload key, outside a browser, can store files, and each must match its hash',async()=>{
 const e=env(),body='RIFF test',digest=await sha(body);
 assert.equal((await call(e,'files/'+digest,{method:'PUT',key:'dev-secret',origin:null,body})).status,405);
 assert.equal((await call(e,'files/'+digest,{method:'PUT',key:'upload-secret',body})).status,401,'browsers cannot upload');
 assert.equal((await call(e,'files/'+'0'.repeat(64),{method:'PUT',key:'upload-secret',origin:null,body})).status,400);
 assert.equal((await call(e,'files/'+digest,{method:'PUT',key:'upload-secret',origin:null,body,type:'audio/wav'})).status,201);
 assert.equal((await call(e,'manifest.json',{method:'PUT',key:'upload-secret',origin:null,body:'[]'})).status,400);
 const r=await call(e,'files/'+digest,{key:'dev-secret'});
 assert.equal(r.status,200);assert.equal(await r.text(),body);assert.equal(r.headers.get('content-type'),'audio/wav');
 assert.equal(r.headers.get('cache-control'),'private, no-store');
});
test('a dev link stores the key and leaves the address bar',()=>{
 forgetDevKey();let replaced;
 assert.equal(takeDevLink({hash:'',pathname:'/x/',search:''},{replaceState(){}}),false);
 assert.equal(takeDevLink({hash:'#dev=abc_DEF-1',pathname:'/RH_Fever_Browser/',search:''},{replaceState:(a,b,url)=>{replaced=url;}}),true);
 assert.equal(devKey(),'abc_DEF-1');assert.equal(replaced,'/RH_Fever_Browser/');
});
test('downloads each game into its own cache like an import, checks hashes, refuses another converter version',async()=>{
 const e=env(),files={'golf':{'menu.json':'{"description":"hi"}','data-80200000.bin':'\u0001\u0002'},'tap':{'original-timeline.json':'{}'}};
 const manifest={importVersion:'iv1',commit:'abc123',wiiCommonKey:'00112233445566778899aabbccddeeff',games:{}};
 for(const [id,list] of Object.entries(files)){
  manifest.games[id]={files:{}};
  for(const [name,body] of Object.entries(list)){const d=await sha(body);manifest.games[id].files[name]=d;await call(e,'files/'+d,{method:'PUT',key:'upload-secret',origin:null,body});}
 }
 await call(e,'manifest.json',{method:'PUT',key:'upload-secret',origin:null,body:JSON.stringify(manifest)});
 const fetchFn=(url,init)=>{assert.ok(String(url).startsWith(DEV_HOST_URL));return worker.fetch(new Request(String(url).replace(DEV_HOST_URL,'https://devhost.example/'),{...init,headers:{...init.headers,origin:'https://hcussatt.github.io'}}),e);};
 assert.equal(await devCommonKey({key:'dev-secret',fetchFn}),'00112233445566778899aabbccddeeff');
 const games=[{id:'golf',title:'Hole in One'},{id:'tap',title:'Tap Trial'}],ready=[];
 await assert.rejects(installFromDevHost({build:{assetVersion:'a1',importVersion:'other'},games,key:'dev-secret',fetchFn}),/different converter version/);
 await assert.rejects(installFromDevHost({build:{assetVersion:'a1',importVersion:'iv1'},games,key:'wrong',fetchFn}),/did not accept/);
 await installFromDevHost({build:{assetVersion:'a1',importVersion:'iv1'},games,key:'dev-secret',fetchFn,onGame:id=>ready.push(id)});
 assert.deepEqual(ready,['golf','tap']);
 const library=await readLibrary(),entry=library.games.golf;
 assert.equal(entry.version,'a1');
 const cached=await (await caches.open(entry.cache)).match(new URL('golf/assets/menu.json',new URL('../web/',import.meta.url)).href);
 assert.equal(await cached.text(),'{"description":"hi"}');assert.equal(cached.headers.get('content-type'),'application/json');
 // A second run with the same files keeps the games without downloading again.
 let fetched=0;
 await installFromDevHost({build:{assetVersion:'a1',importVersion:'iv1'},games,key:'dev-secret',fetchFn:(u,i)=>{fetched++;return fetchFn(u,i);}});
 assert.equal(fetched,1,'only the manifest');assert.equal((await readLibrary()).games.golf.cache,entry.cache);
 // A damaged file is refused and the game stays as it was.
 e.FILES.data.get('files/'+manifest.games.tap.files['original-timeline.json']).body[0]^=1;
 await assert.rejects(installFromDevHost({build:{assetVersion:'a2',importVersion:'iv1'},games,key:'dev-secret',fetchFn}),/damaged/);
 assert.equal((await readLibrary()).games.tap.version,'a1');
});
test('the disc reader checks a typed Wii common key without the site holding it',async()=>{
 assert.equal(keyDigits(' 0x00, 0x11 aa-bb '),'0011aabb');
 assert.match(await checkCommonKey('123'),/32 hexadecimal digits/);
 assert.match(await checkCommonKey('00112233445566778899aabbccddeeff'),/not the retail Wii common key/);
});
