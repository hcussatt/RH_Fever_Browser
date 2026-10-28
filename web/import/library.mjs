import {siteRoot,readLibrary,writeLibrary,deployment} from '../engine/assets.mjs';
import {mountMultiplayer} from '../engine/multiplayer.mjs';
import {groupGames,UNLISTED} from '../engine/menu.mjs';
import {getDelayMs,setDelayMs,resetDelay,LIMIT_MS} from '../engine/delay.mjs';
import {skipPractice,setSkipPractice} from '../engine/practice.mjs';
import {createLayout} from '../engine/layout.mjs';
import {assetResponse} from '../engine/assets.mjs';
import {devKey,forgetDevKey,takeDevLink,installFromDevHost,devCommonKey} from './devhost.mjs';
import {readCommonKey,checkCommonKey,rememberCommonKey,keyDigits} from './wii-key.mjs';
const $=s=>document.querySelector(s);
let worker,build,games,selected;
// The games game select shows (the importer still prepares every game, the unlisted Rhythm Test too).
const listed=()=>games.filter(g=>!UNLISTED.has(g.id));
const iconURLs=new Map();
// The import bar: games finished out of all games, and how far the whole import is.
function meter({done=0,total=0,fraction=0}={}){
 const percent=Math.round(Math.min(1,Math.max(0,fraction))*100);
 $('.meter-fill').style.width=percent+'%';$('.meter-fill').toggleAttribute('data-empty',percent===0);
 $('.meter-track').setAttribute('aria-valuenow',String(percent));$('.meter-track').setAttribute('aria-valuetext',`${done} of ${total} games ready`);
 $('#meter-games').textContent=`${done} of ${total}`;$('#meter-percent').textContent=percent+'%';
}
const status=(message,error=false)=>{$('#progress').textContent=message;$('#progress').classList.toggle('error',error);};
function busy(value){$('#import').disabled=value;$('#iso').disabled=value;$('#key').disabled=value;$('#remove').disabled=value;$('#dev-download').disabled=value;$('#cancel').hidden=!value;$('#busy').hidden=!value;if(value)meter({total:games?.length||0});}
let menuGroups=[],renderVersion=0;
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
// Behind the menu: the title screen the hovered or selected game opens with (its prologue layout at
// the end of its animation, title text hidden; tools/extract-menu.py), and the game select box in
// its colours. Each change cross-fades.
const titles=new Map();let titleShown=null,titleRequest=0;
function titleScreen(id){
 if(!titles.has(id))titles.set(id,(async()=>{
  const base=new URL(id+'/',siteRoot),data=await (await assetResponse(new URL('assets/prologue-layout.json',base))).json();
  const names=Object.keys(data.animations),g={base,steps:1};
  const layout=await createLayout(g,{spec:{animations:names.map(name=>['RootPane',name]),startAtEnd:names.map((_,i)=>i),hidden:data.hidden},data,events:[]});
  const full=Object.assign(document.createElement('canvas'),{width:832,height:456}),ctx=full.getContext('2d');
  ctx.fillStyle='#000';ctx.fillRect(0,0,832,456);layout.draw(ctx,full);
  // Leave out the black bars many title screens have above and below the picture.
  // A row is bar when nearly all of it is dark; thin lines at a bar's edge (a few rows) don't end it.
  const px=ctx.getImageData(0,0,832,456).data,bar=y=>{let dark=0;for(let i=y*832*4;i<(y+1)*832*4;i+=4)if(Math.max(px[i],px[i+1],px[i+2])<=32)dark++;return dark>=832*.97;};
  const edge=(from,step)=>{let end=from,gap=0;for(let y=from;Math.abs(y-from)<150&&gap<=3;y+=step){if(bar(y)){end=y+step;gap=0;}else gap++;}return end;};
  const top=edge(0,1),bottom=edge(455,-1)+1;
  const canvas=Object.assign(document.createElement('canvas'),{width:832,height:bottom-top});
  canvas.getContext('2d').drawImage(full,0,top,832,bottom-top,0,0,832,bottom-top);
  return {canvas,theme:theme(canvas.getContext('2d'))};
 })().catch(()=>null));
 return titles.get(id);
}
// The title screen's most common lively colour (a coarse histogram of a small copy), or its
// average when it has none.
function theme(ctx){
 const small=Object.assign(document.createElement('canvas'),{width:52,height:28}),s=small.getContext('2d');
 s.drawImage(ctx.canvas,0,0,52,28);const px=s.getImageData(0,0,52,28).data,counts=new Map(),sum=[0,0,0];
 for(let i=0;i<px.length;i+=4){
  const [r,g,b]=[px[i],px[i+1],px[i+2]];sum[0]+=r;sum[1]+=g;sum[2]+=b;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);if(max<60||max-min<40)continue;
  const key=(r>>5)<<6|(g>>5)<<3|b>>5,c=counts.get(key)||{n:0,r:0,g:0,b:0};c.n++;c.r+=r;c.g+=g;c.b+=b;counts.set(key,c);
 }
 const best=[...counts.values()].sort((a,b)=>b.n-a.n)[0],n=px.length/4;
 return best&&best.n>8?[best.r/best.n,best.g/best.n,best.b/best.n]:sum.map(v=>v/n);
}
function showTitle(id){
 const request=++titleRequest,card=[...$('#games').querySelectorAll('.game')].find(c=>c.dataset.game===id);
 if(card?.dataset.ready!=='true'){if(request===titleRequest)setTitle(null);return;}
 titleScreen(id).then(t=>{if(request===titleRequest)setTitle(t);});
}
function setTitle(t){
 if(t===titleShown)return;titleShown=t;
 const back=$('#title-backdrop'),old=back.querySelector('canvas.shown');
 if(t){const c=t.canvas.cloneNode();c.getContext('2d').drawImage(t.canvas,0,0);back.append(c);requestAnimationFrame(()=>requestAnimationFrame(()=>c.classList.add('shown')));}
 if(old){old.classList.remove('shown');setTimeout(()=>old.remove(),700);}
 // The menu's colours follow the title screen: light panels with dark text over a light picture,
 // dark panels with light text over a dark one.
 const root=document.documentElement.style,names=['light','mid','shadow','paper','soft','dot','dark','text','ink','accent','accent-ink','accent-shadow'];
 if(!t){for(const v of names)root.removeProperty('--theme-'+v);return;}
 const [r,g,b]=t.theme,mix=(k,to)=>[r,g,b].map(v=>Math.round(v+(to-v)*k)),rgb=c=>`rgb(${c})`;
 const lum=(.2126*r+.7152*g+.0722*b)/255,colours=lum<.4
  ?{light:mix(.55,0),mid:mix(0,0),shadow:mix(.8,0),paper:mix(.3,0),soft:mix(.35,255),dot:`rgba(${mix(.4,255)},.25)`,dark:mix(.7,0),text:mix(.7,255),ink:mix(.92,255)}
  :{light:mix(.72,255),mid:mix(.45,255),shadow:mix(.45,0),paper:mix(.85,255),soft:mix(.3,255),dot:`rgba(${mix(.1,255)},.27)`,dark:mix(.25,0),text:mix(.6,0),ink:[37,39,31]};
 // The play button wears the title screen's colour itself (lightened over a dark one).
 Object.assign(colours,lum<.4?{accent:mix(.6,255),'accent-ink':mix(.6,0),'accent-shadow':mix(.2,255)}:{accent:mix(0,0),'accent-ink':lum>.55?[37,39,31]:[255,255,255],'accent-shadow':mix(.4,0)});
 for(const v of names)root.setProperty('--theme-'+v,v==='dot'?colours[v]:rgb(colours[v]));
}
// The game's own logo from its title screen heads the menu once any game is imported.
let logoShown=false;
async function showLogo(){
 const id=$('#games .game[data-ready=true]')?.dataset.game;
 if(logoShown||!id)return;logoShown=true;
 try{
  const base=new URL(id+'/',siteRoot),data=await (await assetResponse(new URL('assets/title-layout.json',base))).json();
  const names=Object.keys(data.animations);
  const layout=await createLayout({base,steps:1},{spec:{animations:names.map(name=>['RootPane',name]),startAtEnd:names.map((_,i)=>i),hidden:data.hidden},data,events:[]});
  const full=Object.assign(document.createElement('canvas'),{width:832,height:456}),ctx=full.getContext('2d');layout.draw(ctx,full);
  const px=ctx.getImageData(0,0,832,456).data;let [left,top,right,bottom]=[832,456,0,0];
  for(let y=0;y<456;y++)for(let x=0;x<832;x++)if(px[(y*832+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
  if(right<=left)throw new Error('Empty logo');
  const logo=Object.assign(document.createElement('canvas'),{width:right-left,height:bottom-top,className:'logo'});
  logo.getContext('2d').drawImage(full,left,top,right-left,bottom-top,0,0,right-left,bottom-top);
  const h1=$('.marquee h1');h1.querySelector('.logo')?.remove();h1.prepend(logo);h1.classList.add('has-logo');
 }catch{logoShown=false;}
}
function selectGame(id,{focus=false,reveal=true,animate=true}={}){
 const card=[...$('#games').querySelectorAll('.game')].find(card=>card.dataset.game===id);
 if(!card)return;
 const changed=selected!==id;selected=id;showTitle(id);
 for(const other of $('#games').querySelectorAll('.game')){const active=other===card;other.setAttribute('aria-pressed',String(active));other.tabIndex=active?0:-1;}
 const group=menuGroups[Number(card.dataset.group)];
 $('#selected-title').textContent=card.dataset.title;
 $('#selected-art').dataset.game=id;$('#selected-art').replaceChildren(card.querySelector('.game-art').cloneNode(true));$('#selected-art').hidden=false;
 $('#selected-status').textContent=card.dataset.ready==='true'?card.dataset.description||'Ready when you are.':card.dataset.update==='true'?'Import your disc for this update.':'Load your disc to bring this game to life.';
 $('#selected-action').replaceChildren();
 if(card.dataset.ready==='true'){
  const a=Object.assign(document.createElement('a'),{className:'play',textContent:'PLAY',href:new URL(id+'/',siteRoot)});$('#selected-action').append(a);
 }else{const button=Object.assign(document.createElement('button'),{className:'screen-button',textContent:'Load disc'});button.onclick=openImport;$('#selected-action').append(button);}
 $('#current-set').textContent=group.title;
 for(const dot of $('#set-dots').children)dot.setAttribute('aria-current',String(dot.dataset.group===card.dataset.group));
 $('#previous-set').disabled=Number(card.dataset.group)===0;$('#next-set').disabled=Number(card.dataset.group)===menuGroups.length-1;
 if(focus)card.focus({preventScroll:true});
 if(reveal){const set=card.closest('.game-set'),scroller=$('#games');scroller.scrollTo({left:set.offsetLeft-scroller.offsetLeft-(scroller.clientWidth-set.offsetWidth)/2,behavior:animate&&!reducedMotion()?'smooth':'instant'});}
 if(changed&&animate&&!reducedMotion()){
  card.querySelector('.game-art').animate([{transform:'scale(1.02) rotate(-4deg)'},{transform:'scale(1.24) rotate(2deg)'},{transform:'scale(1.15) rotate(0)'}],{duration:240,easing:'ease-out'});
  $('.game-preview').animate([{transform:'translateY(3px)',opacity:.75},{transform:'translateY(0)',opacity:1}],{duration:160});
 }
}
// Every set is a vertical column, with its remix at the top like the Wii song select.
// DOM and visual order agree, including for screen readers and keyboard navigation.
async function render(){
 const version=++renderVersion,focused=document.activeElement?.classList.contains('game');
 const library=await readLibrary(),fragment=document.createDocumentFragment();
 menuGroups=groupGames(games).map(group=>({...group,games:[...group.games.filter(g=>g.id===group.title.toLowerCase().replace(' ','')),...group.games.filter(g=>g.id!==group.title.toLowerCase().replace(' ',''))]}));
 const order=new Map(groupGames(games).flatMap(group=>group.games).map((game,i)=>[game.id,i+1]));
 for(const [column,group] of menuGroups.entries()){
  const set=document.createElement('section');set.className='game-set';set.setAttribute('aria-labelledby','set-'+column);set.style.setProperty('--set-hue',String(column*47));
  const heading=Object.assign(document.createElement('h4'),{className:'set-title',id:'set-'+column,textContent:group.title});set.append(heading);
  const grid=document.createElement('div');grid.className='set-games';set.append(grid);
  for(const [row,{id,title,icon:hasIcon}] of group.games.entries()){
   const number=order.get(id),cardNumber=String(number).padStart(2,'0');
   const entry=library.games[id],ready=entry?.version===(build.assetVersion||build.version);
   const stored=build.local?(await fetch(new URL(id+'/assets/original-timeline.json',siteRoot),{method:'HEAD'})).ok:ready&&await (await caches.open(entry.cache)).match(new URL(id+'/assets/original-timeline.json',siteRoot));
   const card=document.createElement('button');card.type='button';card.className='game';card.setAttribute('aria-pressed',String(id===selected));card.setAttribute('aria-label',title);card.tabIndex=id===selected?0:-1;
   Object.assign(card.dataset,{game:id,title,group:String(column),row:String(row),number:String(number).padStart(2,'0'),ready:String(!!stored),update:String(!!entry&&!stored),remix:String(id.startsWith('remix'))});
   card.onclick=()=>selectGame(id);card.ondblclick=()=>$('#selected-action .play')?.click();
   const art=document.createElement('span');art.className='game-art';art.setAttribute('aria-hidden','true');
   let icon;
   // A local build marks games without an original icon (Tap Trial), so a stale file from an older build stays hidden.
   if(hasIcon===false);
   else if(stored&&build.local)icon=new URL(id+'/assets/menu-icon.png',siteRoot);
   else if(stored){
    const key=entry.cache,cache=await caches.open(key),response=await cache.match(new URL(id+'/assets/menu-icon.png',siteRoot));
    if(response){if(!iconURLs.has(key))iconURLs.set(key,URL.createObjectURL(await response.blob()));icon=iconURLs.get(key);}
   }
   // The original song select's description (tools/extract-menu.py), for a prepared game.
   if(stored){
    const url=new URL(id+'/assets/menu.json',siteRoot);
    const response=build.local?await fetch(url):await (await caches.open(entry.cache)).match(url);
    if(response?.ok)card.dataset.description=(await response.json().catch(()=>({}))).description||'';
   }
   if(icon){const img=new Image();img.src=icon;img.alt='';img.onerror=()=>{art.classList.remove('has-icon');art.textContent=cardNumber;};art.classList.add('has-icon');art.append(img);}else art.textContent=id.startsWith('remix')?'MIX '+id.slice(5):String(number).padStart(2,'0');
   card.append(art);
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
 showLogo();
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
// Games with a practice play it first unless this is on (engine/practice.mjs).
function showSkipPractice(){const on=skipPractice();$('#skip-practice').setAttribute('aria-checked',String(on));$('#skip-practice').textContent=`Skip practice: ${on?'On':'Off'}`;}
$('#skip-practice').onclick=()=>{setSkipPractice(!skipPractice());showSkipPractice();};
showSkipPractice();
try{
 if(!isSecureContext||!globalThis.caches)throw new Error('Use HTTPS or localhost in a browser with site storage enabled.');
 const deploymentResponse=await fetch(new URL('deployment.json',siteRoot));
 [build,games]=await Promise.all([deploymentResponse.status===404?Promise.resolve({version:'local',local:true}):deployment(),fetch(new URL('games.json',siteRoot)).then(r=>r.json())]);
 if(!games.length)throw new Error('No web games are available in this deployment.');
 selected=groupGames(games)[0].games[0].id;
 $('#version').textContent=build.version;await render();
 // The lobby wears the game it is playing's title screen and colours, like the game select.
 mountMultiplayer({games:listed(),version:build.version,openImport,showGame:id=>showTitle(id??selected)});
 if(!build.local&&'serviceWorker' in navigator)navigator.serviceWorker.register(new URL('sw.js',siteRoot),{scope:siteRoot.pathname}).catch(console.warn);
}catch(e){status(e.message,true);$('#import').disabled=true;}
$('#import-form').onsubmit=async e=>{
 e.preventDefault();if(worker||!build)return;
 const file=$('#iso').files[0];
 if(!file)return;
 if(file.size!==4699979776){status('Select the raw USA ISO (4,699,979,776 bytes).',true);return;}
 if(new TextDecoder().decode(await file.slice(0,6).arrayBuffer())!=='SOME01'){status('This disc is not Rhythm Heaven Fever USA (SOME01).',true);return;}
 // The key typed in, or with the owner's dev link, the one his dev host keeps.
 let key=$('#key').value;
 if(!key.trim()&&devKey()&&!build.local){
  try{status('Getting the Wii common key from the dev host…');key=await devCommonKey();}
  catch(e){status(e.message,true);return;}
 }
 const problem=await checkCommonKey(key);
 if(problem){status(problem,true);return;}
 key=keyDigits(key).toLowerCase();
 // A typed key is remembered; the dev host's is fetched again each time.
 if($('#key').value.trim())rememberCommonKey(key);
 busy(true);
 try{
  const persistent=await navigator.storage?.persist?.();
  status(persistent?'Preparing games. Local storage persistence granted.':'Preparing games. Your browser may reclaim storage when space is low.');
  worker=new Worker(new URL('worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=async({data})=>{
   if(data.type==='progress'){status(data.message);meter(data);}
   if(data.type==='game'){status(data.title+' is ready.');meter(data);await render();}
   if(data.type==='done'||data.type==='error'){
    worker?.terminate();worker=null;busy(false);await render();
    status(data.type==='done'?'Your games are ready. Select Play above.':data.message,data.type==='error');
   }
  };
  worker.onerror=e=>{status(e.message||'The importer stopped. Try again.',true);worker?.terminate();worker=null;busy(false);};
  worker.postMessage({file,key,version:build.assetVersion||build.version,games});
 }catch(e){worker?.terminate();worker=null;busy(false);status(e.message,true);}
};
// The owner's dev link (#dev=<key>) lets this browser download his prepared files (devhost.mjs).
let devDownload=null;
const freshDevLink=takeDevLink();
const showDevHost=()=>{
 $('#dev-host').hidden=!devKey()||!!build?.local;
 $('#key-hint').textContent=$('#dev-host').hidden?'Not included with this site. Use the common key from your own Wii (for example from a BootMii keys.bin). This browser remembers it.':'Leave this empty to use the key kept on your dev host.';
};
$('#key').value=readCommonKey();
showDevHost();
if(freshDevLink&&devKey()&&!build?.local){openImport();status('Dev key saved in this browser. Select Download from dev host.');}
$('#dev-forget').onclick=()=>{forgetDevKey();showDevHost();status('Dev key removed from this browser. Downloaded games stay until you remove local game data.');};
$('#dev-download').onclick=async()=>{
 if(worker||devDownload||!build)return;
 devDownload=new AbortController();busy(true);
 try{
  await navigator.storage?.persist?.();
  await installFromDevHost({build,games,signal:devDownload.signal,progress:(message,state)=>{status(message);if(state)meter(state);},onGame:async(id,title,state)=>{status(title+' is ready.');meter(state);await render();}});
  status('Your games are ready. Select Play above.');
 }catch(e){status(e.message,true);}
 finally{devDownload=null;busy(false);await render();}
};
$('#cancel').onclick=()=>{if(devDownload){devDownload.abort();return;}worker?.terminate();worker=null;busy(false);status('Import canceled. Any games already prepared remain available.');render();};
$('#remove').onclick=()=>$('#confirm-remove').showModal();
$('#confirm-remove').onclose=async()=>{
 if($('#confirm-remove').returnValue!=='remove')return;
 await writeLibrary({games:{}});
 for(const name of await caches.keys())if(name.startsWith('rhf-assets:'+siteRoot.pathname+':'))await caches.delete(name);
 await render();status('Local game data removed.');
};
window.addEventListener('beforeunload',e=>{if(worker||devDownload){e.preventDefault();e.returnValue='';}});

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
