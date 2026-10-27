import {siteRoot,readLibrary,writeLibrary,deployment} from '../engine/assets.mjs';
import {mountMultiplayer} from '../engine/multiplayer.mjs';
import {WII_COMMON_KEY} from './common-key.mjs';
import {groupGames,UNLISTED} from '../engine/menu.mjs';
import {getDelayMs,setDelayMs,resetDelay,LIMIT_MS} from '../engine/delay.mjs';
const $=s=>document.querySelector(s);
let worker,build,games,selected;
// The games game select shows (the importer still prepares every game, the unlisted Rhythm Test too).
const listed=()=>games.filter(g=>!UNLISTED.has(g.id));
const iconURLs=new Map();
const status=(message,error=false)=>{$('#progress').textContent=message;$('#progress').classList.toggle('error',error);};
function busy(value){$('#import').disabled=value;$('#iso').disabled=value;$('#remove').disabled=value;$('#cancel').hidden=!value;$('#busy').hidden=!value;}
let menuGroups=[],renderVersion=0;
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function selectGame(id,{focus=false,reveal=true,animate=true}={}){
 const card=[...$('#games').querySelectorAll('.game')].find(card=>card.dataset.game===id);
 if(!card)return;
 const changed=selected!==id;selected=id;
 for(const other of $('#games').querySelectorAll('.game')){const active=other===card;other.setAttribute('aria-pressed',String(active));other.tabIndex=active?0:-1;}
 const group=menuGroups[Number(card.dataset.group)];
 $('#selected-number').textContent=card.dataset.number;
 $('#selected-title').textContent=card.dataset.title;
 $('#selected-art').dataset.game=id;$('#selected-art').replaceChildren(card.querySelector('.game-art').cloneNode(true));$('#selected-art').hidden=false;
 $('#selected-status').textContent=card.dataset.ready==='true'?'Ready when you are.':card.dataset.update==='true'?'Import your disc for this update.':'Load your disc to bring this game to life.';
 $('#selected-action').replaceChildren();
 if(card.dataset.ready==='true'){
  const a=Object.assign(document.createElement('a'),{className:'play',textContent:'LET’S PLAY',href:new URL(id+'/',siteRoot)});$('#selected-action').append(a);
 }else{const button=Object.assign(document.createElement('button'),{className:'screen-button',textContent:'Load disc'});button.onclick=openImport;$('#selected-action').append(button);}
 $('#current-set').textContent=group.title;
 for(const dot of $('#set-dots').children)dot.setAttribute('aria-current',String(dot.dataset.group===card.dataset.group));
 $('#previous-set').disabled=Number(card.dataset.group)===0;$('#next-set').disabled=Number(card.dataset.group)===menuGroups.length-1;
 if(focus)card.focus({preventScroll:true});
 if(reveal){const set=card.closest('.game-set'),scroller=$('#games');scroller.scrollTo({left:set.offsetLeft-scroller.offsetLeft-(scroller.clientWidth-set.offsetWidth)/2,behavior:animate&&!reducedMotion()?'smooth':'instant'});}
 if(changed&&animate&&!reducedMotion()){
  card.querySelector('.game-art').animate([{transform:'scale(.92) rotate(-4deg)'},{transform:'scale(1.1) rotate(2deg)'},{transform:'scale(1.04) rotate(0)'}],{duration:240,easing:'ease-out'});
  $('.game-preview').animate([{transform:'translateY(3px)',opacity:.75},{transform:'translateY(0)',opacity:1}],{duration:160});
 }
}
// Every set is a vertical column, with its remix at the top like the Wii song select.
// DOM and visual order agree, including for screen readers and keyboard navigation.
async function render(){
 const version=++renderVersion,focused=document.activeElement?.classList.contains('game');
 const library=await readLibrary(),fragment=document.createDocumentFragment();
 menuGroups=groupGames(games).map(group=>({...group,games:[...group.games.filter(g=>g.id===group.title.toLowerCase().replace(' ','')),...group.games.filter(g=>g.id!==group.title.toLowerCase().replace(' ',''))]}));
 const order=new Map(groupGames(games).flatMap(group=>group.games).map((game,i)=>[game.id,i+1]));let readyCount=0;
 for(const [column,group] of menuGroups.entries()){
  const set=document.createElement('section');set.className='game-set';set.setAttribute('aria-labelledby','set-'+column);set.style.setProperty('--set-hue',String(column*47));
  const heading=Object.assign(document.createElement('h4'),{className:'set-title',id:'set-'+column,textContent:group.title});set.append(heading);
  const grid=document.createElement('div');grid.className='set-games';set.append(grid);
  for(const [row,{id,title}] of group.games.entries()){
   const number=order.get(id),cardNumber=String(number).padStart(2,'0');
   const entry=library.games[id],ready=entry?.version===(build.assetVersion||build.version);
   const stored=build.local?(await fetch(new URL(id+'/assets/original-timeline.json',siteRoot),{method:'HEAD'})).ok:ready&&await (await caches.open(entry.cache)).match(new URL(id+'/assets/original-timeline.json',siteRoot));
   if(stored)readyCount++;
   const card=document.createElement('button');card.type='button';card.className='game';card.setAttribute('aria-pressed',String(id===selected));card.setAttribute('aria-label',title);card.tabIndex=id===selected?0:-1;
   Object.assign(card.dataset,{game:id,title,group:String(column),row:String(row),number:String(number).padStart(2,'0'),ready:String(!!stored),update:String(!!entry&&!stored),remix:String(id.startsWith('remix'))});
   card.onclick=()=>selectGame(id);card.ondblclick=()=>$('#selected-action .play')?.click();
   const art=document.createElement('span');art.className='game-art';art.setAttribute('aria-hidden','true');
   let icon;
   if(stored&&build.local)icon=new URL(id+'/assets/menu-icon.png',siteRoot);
   else if(stored){
    const key=entry.cache,cache=await caches.open(key),response=await cache.match(new URL(id+'/assets/menu-icon.png',siteRoot));
    if(response){if(!iconURLs.has(key))iconURLs.set(key,URL.createObjectURL(await response.blob()));icon=iconURLs.get(key);}
   }
   if(icon){const img=new Image();img.src=icon;img.alt='';img.onerror=()=>{art.textContent=cardNumber;};art.append(img);}else art.textContent=id.startsWith('remix')?'MIX '+id.slice(5):String(number).padStart(2,'0');
   card.append(art);
   card.append(Object.assign(document.createElement('span'),{className:'game-index',textContent:String(number).padStart(2,'0')}));
   card.append(Object.assign(document.createElement('h3'),{textContent:title}));
   card.append(Object.assign(document.createElement('p'),{textContent:stored?'Ready to play':entry?'Update required':'Load disc to play'}));
   grid.append(card);
  }
  fragment.append(set);
 }
 if(version!==renderVersion)return;
 $('#games').replaceChildren(fragment);$('#set-dots').replaceChildren();
 for(const [i,group] of menuGroups.entries()){
  const dot=document.createElement('button');dot.type='button';dot.dataset.group=String(i);dot.setAttribute('aria-label','Go to '+group.title);dot.onclick=()=>moveSelection(i-Number($('#games .game[aria-pressed=true]').dataset.group),0);$('#set-dots').append(dot);
 }
 $('#collection-count').textContent=String(readyCount).padStart(2,'0')+' / '+String(listed().length).padStart(2,'0');
 selectGame(selected,{focus:focused,animate:false});
 const estimate=await navigator.storage?.estimate?.();
 $('#storage').textContent=estimate?`${Math.round((estimate.usage||0)/1048576)} MB stored by this origin. Clearing site data removes your games.`:'Clearing site data removes your imported games.';
}
function moveSelection(dx,dy){
 const current=$('#games .game[aria-pressed=true]');if(!current)return;
 const column=Math.max(0,Math.min(menuGroups.length-1,Number(current.dataset.group)+dx)),cards=[...$('#games').querySelectorAll(`.game[data-group="${column}"]`)];
 const row=dx?Math.min(Number(current.dataset.row),cards.length-1):(Number(current.dataset.row)+dy+cards.length)%cards.length;
 if(cards[row])selectGame(cards[row].dataset.game,{focus:true});
}
function openImport(){if(!$('#import-dialog').open)$('#import-dialog').showModal();}
$('#games').onkeydown=e=>{
 const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
 if(!e.target.matches('.game'))return;
 if(directions[e.key]){e.preventDefault();moveSelection(...directions[e.key]);}
 else if(e.key==='Home'||e.key==='End'){e.preventDefault();const cards=[...$('#games').querySelectorAll('.game')];selectGame(cards[e.key==='Home'?0:cards.length-1].dataset.game,{focus:true});}
 else if(e.key==='Enter'&&e.target.dataset.game===selected){e.preventDefault();$('#selected-action .play')?.click();}
};
$('#previous-set').onclick=()=>moveSelection(-1,0);$('#next-set').onclick=()=>moveSelection(1,0);
$('#games').addEventListener('wheel',e=>{
 const scroller=$('#games');
 if(Math.abs(e.deltaY)<=Math.abs(e.deltaX)||e.ctrlKey)return;
 const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?scroller.clientWidth:1),max=scroller.scrollWidth-scroller.clientWidth;
 if(delta<0&&scroller.scrollLeft>0||delta>0&&scroller.scrollLeft<max-1){e.preventDefault();scroller.scrollLeft+=delta;}
},{passive:false});
$('#open-import').onclick=openImport;
$('#screen-import').onclick=openImport;
$('#close-import').onclick=()=>$('#import-dialog').close();
$('#help').onclick=()=>$('#help-dialog').showModal();
$('#close-help').onclick=()=>$('#help-dialog').close();
// The audio delay the Rhythm Test (the calibrate game) set, and its reset to the default 0.
const showDelay=()=>{$('#delay-value').textContent=getDelayMs()+' ms';$('#delay-input').value=getDelayMs();};
// Or a delay typed in, kept within delay.mjs's limits.
$('#delay-input').min=LIMIT_MS[0];$('#delay-input').max=LIMIT_MS[1];
$('#delay-form').onsubmit=e=>{e.preventDefault();const v=Number($('#delay-input').value);if(Number.isFinite(v))setDelayMs(v);showDelay();};
$('#open-delay').onclick=()=>{showDelay();$('#delay-dialog').showModal();};
$('#close-delay').onclick=()=>$('#delay-dialog').close();
$('#delay-reset').onclick=()=>{resetDelay();showDelay();};
try{
 if(!isSecureContext||!globalThis.caches)throw new Error('Use HTTPS or localhost in a browser with site storage enabled.');
 const deploymentResponse=await fetch(new URL('deployment.json',siteRoot));
 [build,games]=await Promise.all([deploymentResponse.status===404?Promise.resolve({version:'local',local:true}):deployment(),fetch(new URL('games.json',siteRoot)).then(r=>r.json())]);
 if(!games.length)throw new Error('No web games are available in this deployment.');
 selected=groupGames(games)[0].games[0].id;$('#game-count').textContent=String(listed().length).padStart(2,'0');
 $('#version').textContent=build.version;await render();
 mountMultiplayer({games:listed(),version:build.version,openImport});
 if(!build.local&&'serviceWorker' in navigator)navigator.serviceWorker.register(new URL('sw.js',siteRoot),{scope:siteRoot.pathname}).catch(console.warn);
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

// Standard gamepad navigation uses the same selection and action as the keyboard menu.
let lastControllerDirection=0,lastControllerA=false;
function pollMenuController(){
 const pad=Array.from(navigator.getGamepads?.()||[]).find(Boolean);
 const direction=pad?.buttons[12]?.pressed||pad?.axes[1]<-.5?-2:pad?.buttons[13]?.pressed||pad?.axes[1]>.5?2:pad?.buttons[14]?.pressed||pad?.axes[0]<-.5?-1:pad?.buttons[15]?.pressed||pad?.axes[0]>.5?1:0;
 const a=!!pad?.buttons[0]?.pressed;
 if(!document.hidden&&!document.querySelector('dialog[open]')&&!$('.cabinet').hidden){
  if(direction&&direction!==lastControllerDirection)moveSelection(Math.abs(direction)===1?Math.sign(direction):0,Math.abs(direction)===2?Math.sign(direction):0);
  if(a&&!lastControllerA)$('#selected-action .play')?.click();
 }
 lastControllerDirection=direction;lastControllerA=a;requestAnimationFrame(pollMenuController);
}
requestAnimationFrame(pollMenuController);
