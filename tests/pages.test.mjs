// No disc or key in CI. Real ISO import and full-level checks are local integration tests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';

test('Pages project path, local import errors, storage isolation, and offline shell',async()=>{
 const root=resolve('site'),prefix='/RH_Fever_Browser/';
 const catalog=JSON.parse(await readFile(resolve(root,'games.json'),'utf8')),first=catalog[0].id;
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(!url.pathname.startsWith(prefix))throw new Error('outside project');
   let name=decodeURIComponent(url.pathname.slice(prefix.length));if(!name||name.endsWith('/'))name+='index.html';
   const path=resolve(root,name);if(!path.startsWith(root+'/'))throw new Error('outside root');
   const data=await readFile(path);
   res.setHeader('content-type',({'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');
   res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}${prefix}`;
 const browser=await chromium.launch({headless:true,channel:process.env.RHF_BROWSER_CHANNEL||undefined});
 try{
  const context=await browser.newContext();const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // A new catalog entry appears without changing picker code or a game list.
  await page.route('**/games.json',route=>route.fulfill({json:[{id:'newplugin',title:'New Plugin',expectedCues:7},...catalog]}));
  await page.goto(base);
  await page.waitForFunction(count=>document.querySelectorAll('.game').length===count,catalog.length+1);
  // A game no remix set lists goes under Other games, the last set (engine/menu.mjs).
  assert.ok((await page.locator('.game h3').allTextContents()).includes('New Plugin'));
  assert.equal(await page.locator('.set-title').last().textContent(),'Other games');
  assert.equal(await page.locator('#game-count').textContent(),String(catalog.length+1).padStart(2,'0'));
  await page.unroute('**/games.json');
  await page.goto(base);await page.waitForFunction(count=>document.querySelectorAll('.game').length===count,catalog.length);
  assert.equal(await page.locator('.game').count(),catalog.length);
  assert.equal(await page.locator('#game-count').textContent(),String(catalog.length).padStart(2,'0'));
  assert.equal(await page.locator('.play').count(),0);
  await page.locator('.game[data-game=golf]').focus();
  await page.locator('.game[data-game=golf]').press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('.game[data-game=fork]').getAttribute('aria-pressed')==='true');
  assert.equal(await page.locator('.game[data-game=fork]').evaluate(el=>document.activeElement===el),true);
  // Controller edges move once per press, and modal dialogs keep menu input out.
  await page.evaluate(()=>{
   window.testPad={buttons:Array.from({length:16},()=>({pressed:false})),axes:[0,0]};
   Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});
   window.testPad.buttons[15].pressed=true;
  });
  await page.waitForFunction(()=>document.querySelector('.game[data-game=bun]').getAttribute('aria-pressed')==='true');
  await page.evaluate(()=>window.testPad.buttons[15].pressed=false);
  await page.locator('#help').click();
  await page.evaluate(()=>window.testPad.axes[0]=1);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.game[data-game=bun]').getAttribute('aria-pressed'),'true');
  await page.locator('#close-help').click();
  await page.evaluate(()=>window.testPad.axes[0]=0);
  const scroller=page.locator('#games');
  assert.ok(await scroller.evaluate(el=>el.scrollWidth>el.clientWidth),'catalog scrolls horizontally');
  await page.locator('#next-set').click();
  await page.waitForFunction(()=>document.querySelector('.game[data-game=interview]').getAttribute('aria-pressed')==='true');
  await page.locator('.game[data-game=interview]').press('ArrowUp');
  assert.equal(await page.locator('.game[data-game=remix4]').getAttribute('aria-pressed'),'true');
  await page.locator('.game[data-game=remix4]').press('End');
  // End goes to the last game: Night Walk, last of the Other games.
  await page.waitForFunction(()=>document.querySelector('.game[data-game=nightwalk]').getAttribute('aria-pressed')==='true');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.game[data-game=nightwalk]').press('Home');
  assert.equal(await page.locator('.game[data-game=remix1]').getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1280,height:720});
  await page.locator('#open-import').click();
  await page.locator('#iso').setInputFiles({name:'wrong.iso',mimeType:'application/octet-stream',buffer:Buffer.from('SOME01')});
  assert.equal(await page.locator('#key').count(),0);await page.locator('#import').click();
  await page.waitForFunction(()=>document.querySelector('#progress').textContent.includes('4,699,979,776'));
  // Direct game links explain how to import instead of attempting absent asset URLs.
  await page.goto(base+first+'/');await page.waitForFunction(()=>window.rhf?.error);
  assert.match(await page.locator('#status').textContent(),/Import your ISO/);
  await page.goto(base);await page.waitForFunction(count=>document.querySelectorAll('.game').length===count,catalog.length);
  // A synthetic Cache API fixture exercises library readiness and removal without game data.
  await page.evaluate(async id=>{
   const {readLibrary,writeLibrary,siteRoot,deployment}=await import('./engine/assets.mjs');
   const build=await deployment(),name='rhf-assets:'+siteRoot.pathname+':test';
   await(await caches.open(name)).put(new URL(id+'/assets/original-timeline.json',siteRoot),new Response('{}'));
   const icon=document.createElement('canvas');icon.width=icon.height=8;icon.getContext('2d').fillRect(0,0,8,8);
   const blob=await new Promise(resolve=>icon.toBlob(resolve));
   await(await caches.open(name)).put(new URL(id+'/assets/menu-icon.png',siteRoot),new Response(blob,{headers:{'content-type':'image/png'}}));
   const library=await readLibrary();library.games[id]={cache:name,version:build.assetVersion};await writeLibrary(library);
   await caches.open('rhf-assets:/another-project/:keep');
  },first);
  await page.reload();await page.locator('.play').waitFor();
  assert.equal(await page.locator('.play').count(),1);
  await page.waitForFunction(()=>document.querySelector('.game-art img')?.naturalWidth===8);
  await page.locator('#open-import').click();await page.locator('#remove').click();await page.locator('button[value=remove]').click();
  await page.waitForFunction(()=>document.querySelector('#progress').textContent.includes('removed'));
  assert.equal(await page.locator('.play').count(),0);
  assert.ok(await page.evaluate(async()=>(await caches.keys()).includes('rhf-assets:/another-project/:keep')));
  // Real WebRTC signaling and lobby controls; the iframe is a disc-free engine fixture.
  const guestContext=await browser.newContext({serviceWorkers:'block'});
  const hostContext=await browser.newContext({serviceWorkers:'block'});
  try{
   const host=await hostContext.newPage(),guest=await guestContext.newPage();
   for(const c of [hostContext,guestContext]){
    await c.route('**/assets/original-timeline.json',r=>r.fulfill({json:{}}));
    await c.route('**/?lobby=1',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><p>Local engine fixture</p><script>
     const id=location.pathname.split('/').filter(Boolean).at(-1);let began=0;
     window.rhf={multiplayer:{attach(){},game:()=>({manifest:{id},chart:{}}),gameUrl:new URL('./',location.href),
      prepare:async()=>{},start:at=>{began=at;},stop:()=>{began=0;},snapshot:()=>({hits:0,misses:0,through:0,stray:0,perfectFailed:0,position:began?Math.max(0,(performance.now()-began)/1000):0})}};
    </script>`}));
   }
   await host.goto(base);await guest.goto(base);
   await host.locator('#open-multiplayer').click();await guest.locator('#open-multiplayer').click();
   await guest.locator('#lobby-incoming').fill('invalid');await guest.locator('#lobby-join').click();
   await guest.locator('#lobby-status').getByText(/Invalid/).waitFor();
   await host.locator('#lobby-create').click();await host.waitForFunction(()=>document.querySelector('#lobby-output').value.length>0);
   await guest.locator('#lobby-incoming').fill(await host.locator('#lobby-output').inputValue());await guest.locator('#lobby-join').click();
   await guest.waitForFunction(()=>document.querySelector('#lobby-output').value.length>0);
   await host.locator('#lobby-incoming').fill(await guest.locator('#lobby-output').inputValue());await host.locator('#lobby-accept').click();
   for(const p of [host,guest])await p.waitForFunction(()=>window.rhfLobby?.peer.connected&&window.rhfLobby?.api);
   assert.equal(await guest.locator('#lobby-game').isEnabled(),false);
   const next=catalog[1].id;await host.locator('#lobby-game').selectOption(next);
   await guest.waitForFunction(id=>window.rhfLobby.peer.selectedGame===id&&window.rhfLobby.api?.game().manifest.id===id,next);
   await host.waitForFunction(id=>window.rhfLobby.api?.game().manifest.id===id,next);
   await guest.locator('#lobby-ready').click();await host.locator('#lobby-ready').click();
   for(const p of [host,guest])await p.waitForFunction(()=>window.rhfLobby.peer.state==='playing');
   const result={hits:10,misses:0,through:0,stray:0,perfectFailed:0};
   await host.evaluate(r=>window.rhfLobby.peer.finish(r),result);
   assert.equal(await host.locator('#lobby-game').isEnabled(),false);
   await guest.evaluate(r=>window.rhfLobby.peer.finish(r),result);
   for(const p of [host,guest])await p.waitForFunction(()=>window.rhfLobby.peer.state==='finished'&&window.rhfLobby.peer.remoteResult);
   assert.equal(await host.locator('#lobby-status').textContent(),'Draw');
   await host.locator('#lobby-rematch').click();
   for(const p of [host,guest])await p.waitForFunction(()=>window.rhfLobby.peer.state==='lobby');
   await host.locator('#lobby-ready').click();await guest.locator('#lobby-ready').click();
   for(const p of [host,guest])await p.waitForFunction(()=>window.rhfLobby.peer.state==='playing');
   await host.evaluate(()=>window.rhfLobby.peer.interrupt('Pause test'));
   for(const p of [host,guest])await p.waitForFunction(()=>window.rhfLobby.peer.state==='interrupted');
   await guest.locator('#lobby-rematch').click();
   for(const p of [host,guest])await p.waitForFunction(()=>window.rhfLobby.peer.state==='lobby'&&!window.rhfLobby.peer.localReady);
   await host.setViewportSize({width:390,height:844});assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{await hostContext.close();await guestContext.close();}
  // Wait for install to finish, then verify the static shell survives an offline reload.
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await page.reload();await page.waitForFunction(count=>document.querySelectorAll('.game').length===count,catalog.length);
  assert.equal(await page.locator('#version').textContent(),JSON.parse(await readFile('site/deployment.json','utf8')).version);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
