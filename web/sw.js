// Static runtime only. Local game assets are managed separately by the importer.
const VERSION='__VERSION__',FILES=__FILES__;
const ROOT=new URL('./',self.location.href),PREFIX='rhf-shell:'+ROOT.pathname+':',CACHE=PREFIX+VERSION;
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 await cache.addAll(FILES.map(name=>new URL(name,ROOT).href));
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
  return cached||fetch(event.request);
 })());
});
