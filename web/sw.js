// Static runtime only. Local game assets are managed separately by the importer.
const VERSION='__VERSION__',FILES=__FILES__;
const ROOT=new URL('./',self.location.href),PREFIX='rhf-shell:'+ROOT.pathname+':',CACHE=PREFIX+VERSION;
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 const lazy=name=>/-core\.(wasm|mjs)$/.test(name);
 await cache.addAll(FILES.filter(name=>!lazy(name)).map(name=>new URL(name,ROOT).href));
 // Carry over already-downloaded cores only when their exact build hash still matches.
 const current=await(await cache.match(new URL('deployment.json',ROOT))).json();
 for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE){
  const old=await caches.open(key),metadata=await old.match(new URL('deployment.json',ROOT));if(!metadata)continue;
  const previous=await metadata.json();
  for(const name of FILES.filter(lazy))if(previous.files?.[name]===current.files?.[name]){
   const url=new URL(name,ROOT),response=await old.match(url);if(response)await cache.put(url,response);
  }
 }
})()));
// New deployments wait until existing tabs close so a running game keeps its runtime.
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
 let name=url.pathname.slice(ROOT.pathname.length);if(!name||name.endsWith('/'))name+='index.html';
 if(!FILES.includes(name))return;
 event.respondWith((async()=>{
  const cached=await (await caches.open(CACHE)).match(new URL(name,ROOT));
  if(cached)return cached;
  const response=await fetch(event.request);
  if(response.ok)try{await(await caches.open(CACHE)).put(new URL(name,ROOT),response.clone());}catch(e){console.warn('Runtime is available online but could not be saved offline.',e);}
  return response;
 })());
});
