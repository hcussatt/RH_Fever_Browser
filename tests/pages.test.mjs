// No disc or key in CI. Real ISO import and full-level checks are local integration tests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';

test('Pages project path, local import errors, storage isolation, and offline shell',async()=>{
 const root=resolve('site'),prefix='/RH_Fever_Browser/';
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
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('.game').nth(2).waitFor();
  assert.equal(await page.locator('.game').count(),3);
  assert.equal(await page.locator('.play').count(),0);
  await page.locator('#open-import').click();
  await page.locator('#iso').setInputFiles({name:'wrong.iso',mimeType:'application/octet-stream',buffer:Buffer.from('SOME01')});
  assert.equal(await page.locator('#key').count(),0);await page.locator('#import').click();
  await page.waitForFunction(()=>document.querySelector('#progress').textContent.includes('4,699,979,776'));
  // Direct game links explain how to import instead of attempting absent asset URLs.
  await page.goto(base+'golf/');await page.waitForFunction(()=>window.rhf?.error);
  assert.match(await page.locator('#status').textContent(),/Import your ISO/);
  await page.goto(base);await page.locator('.game').nth(2).waitFor();
  // A synthetic Cache API fixture exercises library readiness and removal without game data.
  await page.evaluate(async()=>{
   const {readLibrary,writeLibrary,siteRoot,deployment}=await import('./engine/assets.mjs');
   const build=await deployment(),name='rhf-assets:'+siteRoot.pathname+':test';
   await(await caches.open(name)).put(new URL('golf/assets/original-timeline.json',siteRoot),new Response('{}'));
   const library=await readLibrary();library.games.golf={cache:name,version:build.assetVersion};await writeLibrary(library);
   await caches.open('rhf-assets:/another-project/:keep');
  });
  await page.reload();await page.locator('.play').waitFor();
  assert.equal(await page.locator('.play').count(),1);
  await page.locator('#open-import').click();await page.locator('#remove').click();await page.locator('button[value=remove]').click();
  await page.waitForFunction(()=>document.querySelector('#progress').textContent.includes('removed'));
  assert.equal(await page.locator('.play').count(),0);
  assert.ok(await page.evaluate(async()=>(await caches.keys()).includes('rhf-assets:/another-project/:keep')));
  // Wait for install to finish, then verify the static shell survives an offline reload.
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await page.reload();await page.locator('.game').nth(2).waitFor();
  assert.equal(await page.locator('#version').textContent(),JSON.parse(await readFile('site/deployment.json','utf8')).version);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
