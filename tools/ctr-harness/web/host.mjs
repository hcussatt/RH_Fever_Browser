// The probe page: starts audio on the first click, runs the game in a worker, draws its top screen
// and passes the A button (Space, Left Shift or left click) and B (Right Shift or right click).
let canvas=document.querySelector('canvas');
const status=document.getElementById('status'),judge=document.getElementById('judge'),skip=document.getElementById('skip');
let ctx; // the 2D fallback when the worker cannot draw with WebGL
let worker,node,audio,held=new Map(); // held key or mouse button -> its 3DS button bit (1 = A, 2 = B)
// Whether games skip their practice: the same switch, kept in this browser, as the Fever site's game
// select. Off by default, so a game plays its practice (and its title card) before the song, as the
// original does on a first play.
const SKIP_KEY='rhf-skip-practice';
const skipPractice=()=>{try{return localStorage.getItem(SKIP_KEY)==='1';}catch{return false;}};
const setSkipPractice=on=>{try{if(on)localStorage.setItem(SKIP_KEY,'1');else localStorage.removeItem(SKIP_KEY);}catch{}};
// The games in this build (games.json, written by build-web.sh). Without ?GAME= the page lists them all;
// ?GAME=index plays that one.
const games=await (await fetch('games.json')).json(),params=new URLSearchParams(location.search);
const game=games.find(g=>String(g.game)===params.get('GAME'));
if(!game){
  document.title='Megamix games';canvas.hidden=true;judge.hidden=true;status.textContent='Pick a game:';
  const list=document.getElementById('games');list.className='list';
  list.innerHTML=games.map(g=>`<a href="?GAME=${g.game}">${g.title}</a>`).join('')+'<button id="skip-practice" role="switch"></button>';
  const toggle=document.getElementById('skip-practice');
  const show=()=>{const on=skipPractice();toggle.setAttribute('aria-checked',String(on));toggle.textContent=`Skip practice: ${on?'On':'Off'}`;};
  toggle.onclick=()=>{setSkipPractice(!skipPractice());show();};show();
}else{
  document.title=game.title;
  status.textContent=`Click to start ${game.title} (A: Space, Left Shift or left click; B: Right Shift or right click).`;
  document.getElementById('games').innerHTML='<a href="./">All games</a>';
}
// Each change carries its event time, so the game can judge it from when it happened.
function pad(e){worker?.postMessage({type:'pad',pad:[...held.values()].reduce((a,b)=>a|b,0),at:performance.timeOrigin+(e?.timeStamp??performance.now())});}
// Speaker latency as the browser reports it; ?delay=ms (or the site's saved audio delay) adds what the
// browser cannot see, such as Bluetooth headphones.
const latency=()=>((audio.outputLatency||0)+(audio.baseLatency||0))*1000;
let delay=0;
async function start(){
  // At the DSP's own rate when the browser allows it, so the browser's resampler (not ours) converts.
  try{audio=new AudioContext({latencyHint:'interactive',sampleRate:32728});}catch{audio=new AudioContext({latencyHint:'interactive'});}
  await audio.audioWorklet.addModule('audio.js');
  let saved=0;try{saved=+localStorage.getItem('rhf-audio-delay-ms')||0;}catch{}
  delay=params.has('delay')?+params.get('delay'):saved;
  setInterval(()=>worker?.postMessage({type:'latency',ms:latency()}),1000);
  // When each moment of the context's audio reaches the speakers (getOutputTimestamp), kept current:
  // with the worklet's sample positions it tells the worker exactly which game sample is heard when.
  setInterval(()=>{const o=audio.getOutputTimestamp?.();if(o?.contextTime>0&&o.performanceTime>0)worker?.postMessage({type:'heard',ctx:o.contextTime,perf:performance.timeOrigin+o.performanceTime});},100);
  // Shaders compiled in earlier sessions are kept in this browser and compiled again before the game starts.
  const SHADERS='rhf-ctr-shaders';let shaders={};try{shaders=JSON.parse(localStorage.getItem(SHADERS)||'{}');}catch{}
  addEventListener('probe-shader',({detail:{key,src}})=>{const v=key.split('|')[0];for(const k of Object.keys(shaders))if(k.split('|')[0]!==v)delete shaders[k];shaders[key]=src;try{localStorage.setItem(SHADERS,JSON.stringify(shaders));}catch{}});
  run(shaders,!skipPractice());
}
// One run of the game: a fresh worker, audio node and canvas (a canvas hands its drawing to one worker only).
function run(shaders,practice){
  node=new AudioWorkletNode(audio,'game-audio',{outputChannelCount:[2]});node.connect(audio.destination);
  const channel=new MessageChannel();node.port.postMessage(channel.port1,[channel.port1]);
  worker=new Worker('worker.mjs',{type:'module'});
  worker.onmessage=({data})=>{
    if(data.type==='frame')(ctx??=canvas.getContext('2d')).putImageData(new ImageData(data.px,400,240),0,0);
    if(data.type==='status')status.textContent=data.text;
    if(data.type==='practice')skip.hidden=true;
    if(['clock','judge','perf','shader','snap','rec'].includes(data.type))dispatchEvent(new CustomEvent('probe-'+data.type,{detail:data})); // tests listen too
    if(data.type==='judge')judge.textContent=`last input ${data.ms>0?'+':''}${data.ms.toFixed(0)} ms (${['outside the windows','barely','just'][data.kind]})`;};
  // Harness settings from the address (?FSTAT=1&DSPLOG=1 ...) pass through to the game's environment;
  // ?PRACTICE=0 or 1 overrides the Skip practice switch; ?PRACTICE=retry starts as on a retry (no title card
  // or practice), as the timing tests and their cue tick lists expect.
  const env=Object.fromEntries(params);env.GAME=String(game.game);delete env.delay;
  env.PRACTICE??=practice?'1':'0';skip.hidden=env.PRACTICE!=='1';
  // WebGL drawing in the worker (OffscreenCanvas) unless ?soft=1 asks for the software picture.
  const offscreen=!env.soft&&canvas.transferControlToOffscreen?canvas.transferControlToOffscreen():null;delete env.soft;
  worker.postMessage({type:'start',port:channel.port2,env,canvas:offscreen,latency:latency(),delay,shaders},offscreen?[channel.port2,offscreen]:[channel.port2]);
  status.textContent='Loading...';
  // Skip during the practice: the game starts again without it (as when the switch is on), from its title card.
  skip.onclick=()=>{skip.hidden=true;worker.terminate();node.disconnect();held.clear();
    const fresh=canvas.cloneNode();canvas.replaceWith(fresh);canvas=fresh;ctx=null;listen(canvas);
    params.delete('PRACTICE');run(shaders,false);};
}
// Keys are taken from the whole page (capture phase, default actions blocked), so Space never
// scrolls or presses a focused control; losing focus releases everything held.
const KEYS={Space:1,ShiftLeft:1,ShiftRight:2},MOUSE={0:1,2:2};
function listen(c){
  c.addEventListener('pointerdown',e=>{e.preventDefault();if(!worker){if(game)start();return;}if(MOUSE[e.button]){c.setPointerCapture(e.pointerId);held.set('mouse'+e.button,MOUSE[e.button]);pad(e);}});
  c.addEventListener('pointerup',e=>{if(held.delete('mouse'+e.button))pad(e);});
  c.addEventListener('pointercancel',e=>{if(held.delete('mouse'+e.button)|held.delete('mouse0')|held.delete('mouse2'))pad();});}
listen(canvas);
addEventListener('keydown',e=>{if(!KEYS[e.code])return;e.preventDefault();if(e.repeat)return;if(!worker){if(game)start();return;}held.set(e.code,KEYS[e.code]);pad(e);},true);
addEventListener('keyup',e=>{if(!KEYS[e.code])return;e.preventDefault();if(held.delete(e.code))pad(e);},true);
addEventListener('blur',()=>{if(held.size){held.clear();pad();}});
document.addEventListener('contextmenu',e=>e.preventDefault());
