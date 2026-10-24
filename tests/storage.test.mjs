import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packAsset,unpackAsset,assetSizes} from '../web/engine/storage.mjs';

test('lossless cache compression restores audio and binary bytes exactly',async()=>{
 const bytes=new Uint8Array(65536);for(let i=0;i<bytes.length;i++)bytes[i]=(i%441)<100?i&255:0;
 for(const type of ['audio/wav','application/octet-stream','application/json']){
  const packed=await packAsset(new Response(bytes,{headers:{'content-type':type}}));
  assert.equal(packed.headers.get('x-rhf-storage'),'gzip');
  const size=await assetSizes(packed);assert.ok(size.bytes<bytes.length/2);assert.equal(size.rawBytes,bytes.length);
  const restored=unpackAsset(packed);assert.equal(restored.headers.get('content-type'),type);
  assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),bytes);
 }
});
test('legacy caches, small files and PNG images remain readable without expansion',async()=>{
 for(const [bytes,type] of [[new Uint8Array([1,2,3]),'application/json'],[new Uint8Array(4096),'image/png']]){
  const packed=await packAsset(new Response(bytes,{headers:{'content-type':type}}));
  assert.equal(packed.headers.get('x-rhf-storage'),null);assert.deepEqual(new Uint8Array(await unpackAsset(packed).arrayBuffer()),bytes);
 }
 const old=new Response('legacy data');assert.equal(await unpackAsset(old).text(),'legacy data');
});
test('already-compressed bodies are not compressed twice; corrupt gzip fails visibly',async()=>{
 const packed=await packAsset(new Response('same data '.repeat(1000))),size=await assetSizes(packed);
 assert.equal((await assetSizes(await packAsset(packed))).bytes,size.bytes);
 await assert.rejects(unpackAsset(new Response('broken',{headers:{'x-rhf-storage':'gzip'}})).arrayBuffer());
 assert.throws(()=>unpackAsset(new Response('data',{headers:{'x-rhf-storage':'unknown'}})),/cannot read/);
});

class MemoryCache {
 data=new Map();
 async match(url){return this.data.get(String(url))?.clone();}
 async put(url,response){this.data.set(String(url),response.clone());}
}
test('identical bytes share one blob while each asset retains its MIME type',async()=>{
 const {storeAsset,readStoredAsset,blobCacheName}=await import('../web/engine/storage.mjs');
 const all=new Map();globalThis.caches={open:async name=>{if(!all.has(name))all.set(name,new MemoryCache());return all.get(name);}};
 const a=new MemoryCache(),b=new MemoryCache(),data=new Uint8Array(65536).fill(12);
 const one=await storeAsset(a,'a',new Response(data,{headers:{'content-type':'audio/wav'}}));
 const two=await storeAsset(b,'b',new Response(data,{headers:{'content-type':'application/octet-stream'}}));
 assert.equal(one.hash,two.hash);assert.equal(all.get(blobCacheName).data.size,1);
 assert.equal((await a.match('a')).headers.get('x-rhf-blob'),one.hash);
 const restored=await readStoredAsset(await b.match('b'));
 assert.equal(restored.headers.get('content-type'),'application/octet-stream');
 assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),data);
 all.get(blobCacheName).data.clear();await assert.rejects(readStoredAsset(await a.match('a')),/incomplete/);
});
test('a failed pointer write leaves the previous asset intact',async()=>{
 const {storeAsset}=await import('../web/engine/storage.mjs');
 const cache=new MemoryCache();await cache.put('a',new Response('previous'));
 cache.put=async()=>{throw new Error('Quota exceeded');};
 await assert.rejects(storeAsset(cache,'a',new Response('updated '.repeat(200))),/Quota/);
 assert.equal(await(await cache.match('a')).text(),'previous');
});
