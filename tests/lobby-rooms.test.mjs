// Room codes end to end: the built lobby in two browsers, with the real matchmaker Worker code
// answering in-process in place of Cloudflare. Needs site/ (tools/prepare-pages.py).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import worker,{Room} from '../matchmaker/worker.mjs';
const MATCHMAKER='https://matchmaker.test/';
test('players connect with a room code; a wrong code fails clearly',async()=>{
 const root=resolve('site'),prefix='/RH_Fever_Browser/';
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');let name=decodeURIComponent(url.pathname.slice(prefix.length));
   if(!url.pathname.startsWith(prefix))throw new Error('outside project');if(!name||name.endsWith('/'))name+='index.html';
   const path=resolve(root,name);if(!path.startsWith(root+'/'))throw new Error('outside root');
   res.setHeader('content-type',({'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json'})[extname(path)]||'application/octet-stream');
   res.end(await readFile(path));
  }catch{res.writeHead(404);res.end('Not found');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}${prefix}`;
 const rooms=new Map(),storage=()=>{const data=new Map();return {async get(k){return data.get(k);},async put(k,v){data.set(k,v);},async deleteAll(){data.clear();},async setAlarm(){},async deleteAlarm(){}};};
 const env={ALLOWED_ORIGINS:'https://hcussatt.github.io',ROOMS:{idFromName:n=>n,get(id){if(!rooms.has(id))rooms.set(id,new Room({storage:storage()}));const room=rooms.get(id);return {fetch:(url,init)=>room.fetch(new Request(url,init))};}}};
 const module=(await readFile(resolve(root,'engine/matchmaker.mjs'),'utf8')).replace(/MATCHMAKER_URL='[^']*'/,`MATCHMAKER_URL='${MATCHMAKER}'`);
 const browser=await chromium.launch({headless:true,channel:process.env.RHF_BROWSER_CHANNEL||undefined});
 try{
  const contexts=await Promise.all([browser.newContext({serviceWorkers:'block'}),browser.newContext({serviceWorkers:'block'})]);
  for(const c of contexts){
   await c.route('**/engine/matchmaker.mjs',r=>r.fulfill({contentType:'text/javascript',body:module}));
   await c.route(MATCHMAKER+'**',async r=>{
    const q=r.request(),response=await worker.fetch(new Request(q.url(),{method:q.method(),headers:q.headers(),body:['POST','PUT'].includes(q.method())?q.postData():undefined}),env);
    await r.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
   });
   await c.route('**/assets/original-timeline.json',r=>r.fulfill({json:{}}));
   await c.route('**/?lobby=1',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><script>
    const id=location.pathname.split('/').filter(Boolean).at(-1);
    window.rhf={multiplayer:{attach(){},game:()=>({manifest:{id},chart:{}}),gameUrl:new URL('./',location.href),prepare:async()=>{},start(){},stop(){},snapshot:()=>({hits:0,misses:0,through:0,stray:0,perfectFailed:0,position:0})}};
   </script>`}));
  }
  const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));
  await host.goto(base);await host.locator('#open-multiplayer').click();
  await guest.goto(base+'#room=ZZZZZZ');assert.equal(await guest.locator('#lobby-room-input').inputValue(),'ZZZZZZ');
  await guest.locator('#lobby-room-join').click();await guest.locator('#lobby-status').getByText(/No room/).waitFor();
  await host.setViewportSize({width:390,height:844});
  await host.locator('#lobby-room-create').click();await host.locator('#lobby-room-share').waitFor();
  assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.RHF_ROOM_SCREENSHOT)await host.screenshot({path:process.env.RHF_ROOM_SCREENSHOT});
  const code=await host.locator('#lobby-room-code').textContent();assert.match(code,/^[A-Z2-9]{6}$/);
  assert.match(await host.locator('#lobby-output').inputValue(),/#invite=/,'the manual invite stays available');
  await guest.locator('#lobby-room-input').fill(code.toLowerCase().slice(0,3)+'-'+code.slice(3));await guest.locator('#lobby-room-join').click();
  for(const p of [host,guest])await p.waitForFunction(()=>window.rhfLobby?.peer.connected&&window.rhfLobby?.api);
  assert.equal(await host.locator('#lobby-setup').isHidden(),true);
  const left=await worker.fetch(new Request(MATCHMAKER+`rooms/${code}/offer`,{headers:{origin:'https://hcussatt.github.io'}}),env);
  assert.equal(left.status,404,'the room is deleted once the host has the answer');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
