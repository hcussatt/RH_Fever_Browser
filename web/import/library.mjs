import {siteRoot,readLibrary,writeLibrary,deployment} from '../engine/assets.mjs';
import {WII_COMMON_KEY} from './common-key.mjs';
import {groupGames} from '../engine/menu.mjs';
const $=s=>document.querySelector(s);
let worker,build,games,selected;
const status=(message,error=false)=>{$('#progress').textContent=message;$('#progress').classList.toggle('error',error);};
function busy(value){$('#import').disabled=value;$('#iso').disabled=value;$('#remove').disabled=value;$('#cancel').hidden=!value;$('#busy').hidden=!value;}
async function render(){
 const library=await readLibrary();$('#games').replaceChildren();
 // Games are listed by remix set (engine/menu.mjs), each set under its title.
 const groups=groupGames(games),titles=new Map(groups.map(g=>[g.games[0].id,g.title]));
 for(const [index,{id,title}] of groups.flatMap(g=>g.games).entries()){
  if(titles.has(id)){const h=document.createElement('h4');h.className='set-title';h.textContent=titles.get(id);$('#games').append(h);}
  const entry=library.games[id],ready=entry?.version===(build.assetVersion||build.version);
  // Verify that storage eviction has not left just the library pointer.
  const stored=ready&&await (await caches.open(entry.cache)).match(new URL(id+'/assets/original-timeline.json',siteRoot));
  const card=document.createElement('button');card.type='button';card.className='game';card.setAttribute('aria-pressed',String(id===selected));card.onclick=()=>{selected=id;render();};
  const number=document.createElement('span');number.className='game-index';number.textContent=String(index+1).padStart(2,'0');card.append(number);
  const h=document.createElement('h3');h.textContent=title;
  const p=document.createElement('p');p.textContent=stored?'● READY TO PLAY':entry?'UPDATE REQUIRED':'○ INSERT DISC';card.append(h,p);
  if(id===selected){
   $('#selected-number').textContent=String(index+1).padStart(2,'0');$('#selected-title').textContent=title;$('#selected-art').dataset.game=id;
   $('#selected-status').textContent=stored?'Ready on this device.':entry?'Import your disc for this update.':'Import your disc to play.';
   $('#selected-action').replaceChildren();
   if(stored){const a=document.createElement('a');a.className='play';a.textContent='LET’S PLAY →';a.href=new URL(id+'/',siteRoot);$('#selected-action').append(a);}
   else{const button=document.createElement('button');button.className='screen-button';button.textContent='INSERT YOUR DISC ↗';button.onclick=openImport;$('#selected-action').append(button);}
  }
  $('#games').append(card);
 }
 const estimate=await navigator.storage?.estimate?.();
 $('#storage').textContent=estimate?`${Math.round((estimate.usage||0)/1048576)} MB stored by this origin. Clearing site data removes your games.`:'Clearing site data removes your imported games.';
}
function openImport(){if(!$('#import-dialog').open)$('#import-dialog').showModal();}
$('#open-import').onclick=openImport;
$('#screen-import').onclick=openImport;
$('#close-import').onclick=()=>$('#import-dialog').close();
$('#help').onclick=()=>$('#help-dialog').showModal();
$('#close-help').onclick=()=>$('#help-dialog').close();
try{
 if(!isSecureContext||!globalThis.caches)throw new Error('Use HTTPS or localhost in a browser with site storage enabled.');
 [build,games]=await Promise.all([deployment(),fetch(new URL('games.json',siteRoot)).then(r=>r.json())]);
 if(!games.length)throw new Error('No web games are available in this deployment.');
 selected=groupGames(games)[0].games[0].id;$('#game-count').textContent=String(games.length).padStart(2,'0');
 $('#version').textContent=build.version;await render();
 if('serviceWorker' in navigator)navigator.serviceWorker.register(new URL('sw.js',siteRoot),{scope:siteRoot.pathname}).catch(console.warn);
}catch(e){status(e.message,true);$('#import').disabled=true;}
$('#import-form').onsubmit=async e=>{
 e.preventDefault();if(worker||!build)return;
 const file=$('#iso').files[0],key=WII_COMMON_KEY;
 if(!file)return;
 if(file.size!==4699979776){status('Select the raw USA ISO (4,699,979,776 bytes).',true);return;}
 if(new TextDecoder().decode(await file.slice(0,6).arrayBuffer())!=='SOME01'){status('This disc is not Rhythm Heaven Fever USA (SOME01).',true);return;}
 if(!/^[a-f0-9]{32}$/i.test(key)){status('Enter the 32 hexadecimal digits of your Wii common key.',true);return;}
 busy(true);
 try{
  const persistent=await navigator.storage?.persist?.();
  status(persistent?'Preparing games. Local storage persistence granted.':'Preparing games. Your browser may reclaim storage when space is low.');
  worker=new Worker(new URL('worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=async({data})=>{
   if(data.type==='progress')status(data.message);
   if(data.type==='game'){status(data.title+' is ready.');await render();}
   if(data.type==='done'||data.type==='error'){
    worker?.terminate();worker=null;busy(false);await render();
    status(data.type==='done'?'Your games are ready. Select Play above.':data.message,data.type==='error');
   }
  };
  worker.onerror=e=>{status(e.message||'The importer stopped. Try again.',true);worker?.terminate();worker=null;busy(false);};
  worker.postMessage({file,key,version:build.assetVersion||build.version,games});
 }catch(e){worker?.terminate();worker=null;busy(false);status(e.message,true);}
};
$('#cancel').onclick=()=>{worker?.terminate();worker=null;busy(false);status('Import cancelled. Any games already prepared remain available.');render();};
$('#remove').onclick=()=>$('#confirm-remove').showModal();
$('#confirm-remove').onclose=async()=>{
 if($('#confirm-remove').returnValue!=='remove')return;
 await writeLibrary({games:{}});
 for(const name of await caches.keys())if(name.startsWith('rhf-assets:'+siteRoot.pathname+':'))await caches.delete(name);
 await render();status('Local game data removed.');
};
window.addEventListener('beforeunload',e=>{if(worker){e.preventDefault();e.returnValue='';}});
