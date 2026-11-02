// The probe page: starts audio on the first click, runs the game in a worker, draws its top screen
// and passes the A button (Space, Left Shift or left click).
const canvas=document.querySelector('canvas'),status=document.getElementById('status'),judge=document.getElementById('judge');
let ctx; // the 2D fallback when the worker cannot draw with WebGL
let worker,held=new Set();
// Each change carries its event time, so the game can judge it from when it happened.
function pad(e){worker?.postMessage({type:'pad',pad:held.size?1:0,at:performance.timeOrigin+(e?.timeStamp??performance.now())});}
async function start(){
  // At the DSP's own rate when the browser allows it, so the browser's resampler (not ours) converts.
  let audio;try{audio=new AudioContext({latencyHint:'interactive',sampleRate:32728});}catch{audio=new AudioContext({latencyHint:'interactive'});}
  await audio.audioWorklet.addModule('audio.js');
  const node=new AudioWorkletNode(audio,'game-audio',{outputChannelCount:[2]});node.connect(audio.destination);
  const channel=new MessageChannel();node.port.postMessage(channel.port1,[channel.port1]);
  worker=new Worker('worker.mjs',{type:'module'});
  worker.onmessage=({data})=>{
    if(data.type==='frame')(ctx??=canvas.getContext('2d')).putImageData(new ImageData(data.px,400,240),0,0);
    if(data.type==='status')status.textContent=data.text;
    if(['clock','judge','perf','shader'].includes(data.type))dispatchEvent(new CustomEvent('probe-'+data.type,{detail:data})); // tests listen too
    if(data.type==='judge')judge.textContent=`last input ${data.ms>0?'+':''}${data.ms.toFixed(0)} ms (${['outside the windows','barely','just'][data.kind]})`;};
  // Harness settings from the address (?FSTAT=1&DSPLOG=1 ...) pass through to the game's environment.
  const env=Object.fromEntries(new URLSearchParams(location.search));
  // WebGL drawing in the worker (OffscreenCanvas) unless ?soft=1 asks for the software picture.
  const offscreen=!env.soft&&canvas.transferControlToOffscreen?canvas.transferControlToOffscreen():null;delete env.soft;
  // Speaker latency as the browser reports it, kept current; ?delay=ms (or the site's saved audio
  // delay) adds what the browser cannot see, such as Bluetooth headphones.
  const latency=()=>((audio.outputLatency||0)+(audio.baseLatency||0))*1000;
  let saved=0;try{saved=+localStorage.getItem('rhf-audio-delay-ms')||0;}catch{}
  const delay=env.delay!==undefined?+env.delay:saved;delete env.delay;
  setInterval(()=>worker.postMessage({type:'latency',ms:latency()}),1000);
  // Shaders compiled in earlier sessions are kept in this browser and compiled again before the game starts.
  const SHADERS='rhf-ctr-shaders';let shaders={};try{shaders=JSON.parse(localStorage.getItem(SHADERS)||'{}');}catch{}
  addEventListener('probe-shader',({detail:{key,src}})=>{shaders[key]=src;try{localStorage.setItem(SHADERS,JSON.stringify(shaders));}catch{}});
  worker.postMessage({type:'start',port:channel.port2,env,canvas:offscreen,latency:latency(),delay,shaders},offscreen?[channel.port2,offscreen]:[channel.port2]);
  status.textContent='Loading...';
}
// Keys are taken from the whole page (capture phase, default actions blocked), so Space never
// scrolls or presses a focused control; losing focus releases everything held.
const A_KEYS=new Set(['Space','ShiftLeft']);
canvas.addEventListener('pointerdown',e=>{e.preventDefault();if(!worker){start();return;}if(e.button===0){canvas.setPointerCapture(e.pointerId);held.add('mouse');pad(e);}});
canvas.addEventListener('pointerup',e=>{if(e.button===0&&held.delete('mouse'))pad(e);});
canvas.addEventListener('pointercancel',()=>{if(held.delete('mouse'))pad();});
addEventListener('keydown',e=>{if(!A_KEYS.has(e.code))return;e.preventDefault();if(e.repeat)return;if(!worker){start();return;}held.add(e.code);pad(e);},true);
addEventListener('keyup',e=>{if(!A_KEYS.has(e.code))return;e.preventDefault();if(held.delete(e.code))pad(e);},true);
addEventListener('blur',()=>{if(held.size){held.clear();pad();}});
document.addEventListener('contextmenu',e=>e.preventDefault());
