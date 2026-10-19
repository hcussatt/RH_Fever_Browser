// A File is mounted read-only; the multi-GB ISO is never loaded into RAM wholesale.
import {traceTimeline} from '../engine/timeline.mjs';
import {readLibrary,writeLibrary,siteRoot} from '../engine/assets.mjs';
const PYODIDE='https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let busy=false;
const progress=message=>postMessage({type:'progress',message});
const mime=name=>name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'application/octet-stream';

async function importISO({file,key,version,games}){
 if(file.size!==4699979776)throw new Error('Select a raw USA Wii ISO (4,699,979,776 bytes). RVZ and WBFS need conversion first.');
 if(new TextDecoder().decode(await file.slice(0,6).arrayBuffer())!=='SOME01')throw new Error('This runtime requires Rhythm Heaven Fever USA (SOME01).');
 if(!/^[0-9a-f]{32}$/i.test(key))throw new Error('The Wii common key must contain 32 hexadecimal digits.');
 progress('Loading the local asset converter…');
 const {loadPyodide}=await import(PYODIDE+'pyodide.mjs');
 const py=await loadPyodide({indexURL:PYODIDE,stdout:()=>{},stderr:console.warn});
 await py.loadPackage(['numpy','pillow','cryptography']);
 const bundle=await fetch(new URL('tools.zip',import.meta.url));
 if(!bundle.ok)throw new Error('Cannot load the asset importer. Reload and try again.');
 py.FS.mkdir('/project');py.FS.chdir('/project');
 py.unpackArchive(await bundle.arrayBuffer(),'zip');
 py.FS.mkdir('/iso');py.FS.mount(py.FS.filesystems.WORKERFS,{files:[file]},'/iso');
 // CPython's WASM file seek uses a 32-bit C long. Read slices through JS so
 // encrypted Wii clusters beyond 2 GB remain accessible without truncation.
 const reader=new FileReaderSync();
 self.readISO=(offset,length)=>new Uint8Array(reader.readAsArrayBuffer(file.slice(Number(offset),Number(offset)+Number(length))));
 py.globals.set('iso_path','/iso/'+file.name);
 py.globals.set('common_key_value',key);
 await py.runPythonAsync(`
import os, sys, runpy, pathlib, json, gc
os.environ['RHF_WII_COMMON_KEY'] = common_key_value
del common_key_value
sys.path.insert(0, '/project/tools')
from js import readISO
from wii_files import WiiFiles
def read_raw(self, offset, length):
    result = bytes(readISO(offset, length).to_py())
    if len(result) != length:
        raise ValueError('Incomplete ISO')
    return result
WiiFiles.raw = read_raw
sys.argv = ['extract-disc.py', iso_path]
runpy.run_path('/project/tools/extract-disc.py', run_name='__main__')
os.environ.pop('RHF_WII_COMMON_KEY', None)
`);
 progress('Disc validated. Preparing games…');
 for(const {id,title} of games){
  progress('Converting '+title+' graphics and audio…');
  py.globals.set('game_id',id);
  await py.runPythonAsync(`
os.environ['RHF_GAME'] = game_id
sys.argv = ['import-assets']
for script in ['prepare-data.py', 'chart-index.py', 'extract-assets.py', 'extract-sfx.py', 'extract-layout.py', 'extract-results.py', 'decode-music.py']:
    runpy.run_path('/project/tools/' + script, run_name='__main__')
    gc.collect()
`);
  const base=new URL(id+'/',siteRoot);
  const load=async url=>{
   const path=new URL(url).pathname;
   const marker='/'+id+'/assets/';
   if(path.includes(marker))return py.FS.readFile('/project/dist/'+id+'/assets/'+path.split(marker)[1]);
   const r=await fetch(url);if(!r.ok)throw new Error('Cannot load '+url);return new Uint8Array(await r.arrayBuffer());
  };
  progress('Checking '+title+' chart…');
  const timeline=await traceTimeline(base,load);
  const expected={golf:64,tap:102,rap:31}[id];
  if(expected&&timeline.cues.length!==expected)throw new Error(title+': unexpected chart cue count.');
  const dir='/project/dist/'+id+'/assets';
  py.FS.writeFile(dir+'/original-timeline.json',JSON.stringify(timeline));
  const name='rhf-assets:'+siteRoot.pathname+':'+version+':'+id+':'+crypto.randomUUID();
  const cache=await caches.open(name);let bytes=0;
  try{
   for(const fileName of py.FS.readdir(dir).filter(n=>/\.(json|png|wav)$/.test(n)||/^data-[0-9a-f]+\.bin$/.test(n))){
    const data=py.FS.readFile(dir+'/'+fileName);bytes+=data.byteLength;
    await cache.put(new URL('assets/'+fileName,base),new Response(data,{headers:{'content-type':mime(fileName)}}));
   }
   // Publish the pointer only after the entire game is stored. An interrupted import
   // leaves any previously working library entry intact.
   const library=await readLibrary(),previous=library.games[id];
   library.games[id]={cache:name,version,bytes,importedAt:new Date().toISOString()};
   await writeLibrary(library);
   if(previous?.cache&&previous.cache!==name)await caches.delete(previous.cache);
  }catch(e){await caches.delete(name);throw e;}
  postMessage({type:'game',id,title});
  await py.runPythonAsync(`
import shutil
shutil.rmtree('/project/dist/' + game_id)
gc.collect()
`);
 }
 postMessage({type:'done'});
}
self.onmessage=async({data})=>{
 if(busy)return;busy=true;
 try{await importISO(data);}catch(e){console.error(e);postMessage({type:'error',message:(e.message||String(e)).trim().split('\n').at(-1)});}finally{close();}
};
