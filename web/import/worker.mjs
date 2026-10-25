// A File is mounted read-only; the multi-GB ISO is never loaded into RAM wholesale.
import {traceTimeline} from '../engine/timeline.mjs';
import {readLibrary,updateLibrary,siteRoot,compactAssets,withStorageLock,storageSummary} from '../engine/assets.mjs';
import {storeAsset} from '../engine/storage.mjs';
import {WII_COMMON_KEY} from './common-key.mjs';
import {decodeDSP,decodeYaz0} from './codecs.mjs';
const PYODIDE='https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let busy=false;
const progress=message=>postMessage({type:'progress',message});
const mime=name=>name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':name.endsWith('.wav')?'audio/wav':'application/octet-stream';

async function importISO({file,key=WII_COMMON_KEY,version,games,mode='icons'}){
 if(file.size!==4699979776)throw new Error('Select a raw USA Wii ISO (4,699,979,776 bytes). RVZ and WBFS need conversion first.');
 if(new TextDecoder().decode(await file.slice(0,6).arrayBuffer())!=='SOME01')throw new Error('This runtime requires Rhythm Heaven Fever USA (SOME01).');
 if(!/^[0-9a-f]{32}$/i.test(key))throw new Error('The Wii common key must contain 32 hexadecimal digits.');
 const generation=(await readLibrary()).generation||0;
 progress('Loading the local asset converter…');
 const {loadPyodide}=await import(PYODIDE+'pyodide.mjs');
 const py=await loadPyodide({indexURL:PYODIDE,stdout:()=>{},stderr:console.warn});
 const [bundle]=await Promise.all([fetch(new URL('tools.zip',import.meta.url)),py.loadPackage(['numpy','pillow','cryptography'])]);
 if(!bundle.ok)throw new Error('Cannot load the asset importer. Reload and try again.');
 py.FS.mkdir('/project');py.FS.chdir('/project');
 py.unpackArchive(await bundle.arrayBuffer(),'zip');
 py.FS.mkdir('/iso');py.FS.mount(py.FS.filesystems.WORKERFS,{files:[file]},'/iso');
 // CPython's WASM file seek uses a 32-bit C long. Read slices through JS so
 // encrypted Wii clusters beyond 2 GB remain accessible without truncation.
 const reader=new FileReaderSync();
 self.readISO=(offset,length)=>new Uint8Array(reader.readAsArrayBuffer(file.slice(Number(offset),Number(offset)+Number(length))));
 self.fastDSP=(raw,coefs,yn1,yn2,length)=>decodeDSP(raw.toJs(),coefs.toJs(),yn1,yn2,length);
 self.fastYaz0=data=>decodeYaz0(data.toJs());
 py.globals.set('iso_path','/iso/'+file.name);
 py.globals.set('common_key_value',key);
 py.globals.set('selected_games_json',JSON.stringify(games.map(g=>g.id)));
 py.globals.set('icons_only',mode==='icons');
 await py.runPythonAsync(`
import os, sys, runpy, pathlib, json, gc
os.environ['RHF_WII_COMMON_KEY'] = common_key_value
del common_key_value
sys.path.insert(0, '/project/tools')
from js import readISO, fastDSP, fastYaz0
import wii_files, nintendo_audio, numpy as np, paths
from wii_files import WiiFiles
def decode_dsp_fast(raw, coefs, yn1, yn2, length):
    return np.frombuffer(bytes(fastDSP(raw, coefs, yn1, yn2, length).to_py()), dtype='<i2')
nintendo_audio.decode_dsp = decode_dsp_fast
wii_files.yaz0 = lambda data: bytes(fastYaz0(data).to_py())
def read_raw(self, offset, length):
    result = bytes(readISO(offset, length).to_py())
    if len(result) != length:
        raise ValueError('Incomplete ISO')
    return result
WiiFiles.raw = read_raw
disc = runpy.run_path('/project/tools/extract-disc.py')['main'](iso_path, sound_archive=False, games=json.loads(selected_games_json), icons_only=icons_only)
sound_offset, sound_length = disc.files['EN/content2/rev_tengoku.brsar']
def read_sound_range(offset, length):
    if offset < 0 or length < 0 or offset + length > sound_length:
        raise ValueError('Invalid sound archive range')
    return disc.read(sound_offset + offset, length)
paths.read_sound_archive = read_sound_range
os.environ.pop('RHF_WII_COMMON_KEY', None)
`);
 if(mode==='icons'){
  progress('Reading game icons from left to right…');
  await withStorageLock(async()=>{
   const previous=(await readLibrary()).icons;
   const name=previous?.cache?.startsWith('rhf-icons:'+siteRoot.pathname+':')?previous.cache:'rhf-icons:'+siteRoot.pathname+':'+crypto.randomUUID();
   const cache=await caches.open(name);let bytes=previous?.bytes||0,count=0,published=false;
   try{
    for(const {id,title} of games){
     py.globals.set('game_id',id);
     await py.runPythonAsync(`os.environ['RHF_GAME'] = game_id; runpy.run_path('/project/tools/extract-menu.py', run_name='__main__')`);
     const path='/project/dist/'+id+'/assets/menu-icon.png';
     if(!py.FS.analyzePath(path).exists)throw new Error(title+': original menu icon is missing.');
     const url=new URL(id+'/assets/menu-icon.png',siteRoot),old=await cache.match(url),data=py.FS.readFile(path);
     bytes+=data.byteLength-(old?(await old.arrayBuffer()).byteLength:0);count++;
     await cache.put(url,new Response(data,{headers:{'content-type':'image/png'}}));
     await updateLibrary(l=>{
      if((l.generation||0)!==generation)throw new Error('Import cancelled because local data was removed.');
      l.icons={cache:name,bytes,disc:'SOME01',count,total:games.length,pending:count<games.length};
     });published=true;
     postMessage({type:'icon',id,title});progress('Reading '+title+' icon…');
    }
   }catch(e){if(!published&&name!==previous?.cache)await caches.delete(name);throw e;}
  });postMessage({type:'done',mode});return;
 }
 progress('Disc validated. Preparing selected game…');
 for(const {id,title,expectedCues} of games){
  progress('Converting '+title+' graphics and audio…');
  py.globals.set('game_id',id);
  await py.runPythonAsync(`
os.environ['RHF_GAME'] = game_id
sys.argv = ['import-assets']
for script in ['prepare-data.py', 'chart-index.py', 'extract-assets.py', 'extract-sfx.py', 'extract-layout.py', 'extract-results.py', 'extract-menu.py', 'decode-music.py']:
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
  if(timeline.cues.length!==expectedCues)throw new Error(title+': unexpected chart cue count.');
  const dir='/project/dist/'+id+'/assets';
  py.FS.writeFile(dir+'/original-timeline.json',JSON.stringify(timeline));
  const name='rhf-assets:'+siteRoot.pathname+':'+version+':'+id+':'+crypto.randomUUID();
  await withStorageLock(async()=>{
  const cache=await caches.open(name);let bytes=0,rawBytes=0;const blobs={};
  try{
   for(const fileName of py.FS.readdir(dir).filter(n=>/\.(json|png|wav)$/.test(n)||/^(data-[0-9a-f]+|sequence-\d+)\.bin$/.test(n))){
    const data=py.FS.readFile(dir+'/'+fileName),size=await storeAsset(cache,new URL('assets/'+fileName,base),new Response(data,{headers:{'content-type':mime(fileName)}}));
    rawBytes+=size.rawBytes;bytes+=size.bytes;blobs[size.hash]=size.bytes;
   }
   // Publish the pointer only after the entire game is stored. An interrupted import
   // leaves any previously working library entry intact.
   let previous;await updateLibrary(library=>{
    if((library.generation||0)!==generation)throw new Error('Import cancelled because local data was removed.');
    previous=library.games[id];
    library.games[id]={cache:name,version,bytes,rawBytes,blobs,storage:'shared-gzip-v1',importedAt:new Date().toISOString()};
   });
   if(previous?.cache&&previous.cache!==name)await caches.delete(previous.cache);
  }catch(e){await caches.delete(name);throw e;}
  const summary=await storageSummary();await updateLibrary(l=>{l.storage=summary;});
  });
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
 try{if(data.mode==='compact'){postMessage({type:'done',...await compactAssets(progress)});}else await importISO(data);}catch(e){console.error(e);postMessage({type:'error',message:(e.message||String(e)).trim().split('\n').at(-1)});}finally{close();}
};
