// The probe page: starts audio on the first click, runs the game in a worker, draws its top screen
// and passes the A button (Space, Left Shift or left click).
const canvas=document.querySelector('canvas'),status=document.getElementById('status');
let ctx; // the 2D fallback when the worker cannot draw with WebGL
let worker,held=new Set();
function pad(){worker?.postMessage({type:'pad',pad:held.size?1:0});}
async function start(){
  // At the DSP's own rate when the browser allows it, so the browser's resampler (not ours) converts.
  let audio;try{audio=new AudioContext({latencyHint:'interactive',sampleRate:32728});}catch{audio=new AudioContext({latencyHint:'interactive'});}
  await audio.audioWorklet.addModule('audio.js');
  const node=new AudioWorkletNode(audio,'game-audio',{outputChannelCount:[2]});node.connect(audio.destination);
  const channel=new MessageChannel();node.port.postMessage(channel.port1,[channel.port1]);
  worker=new Worker('worker.mjs',{type:'module'});
  worker.onmessage=({data})=>{
    if(data.type==='frame')(ctx??=canvas.getContext('2d')).putImageData(new ImageData(data.px,400,240),0,0);
    if(data.type==='status')status.textContent=data.text;};
  // Harness settings from the address (?FSTAT=1&DSPLOG=1 ...) pass through to the game's environment.
  const env=Object.fromEntries(new URLSearchParams(location.search));
  // WebGL drawing in the worker (OffscreenCanvas) unless ?soft=1 asks for the software picture.
  const offscreen=!env.soft&&canvas.transferControlToOffscreen?canvas.transferControlToOffscreen():null;delete env.soft;
  worker.postMessage({type:'start',port:channel.port2,env,canvas:offscreen},offscreen?[channel.port2,offscreen]:[channel.port2]);
  status.textContent='Loading...';
}
canvas.addEventListener('pointerdown',e=>{if(!worker){start();return;}if(e.button===0){held.add('mouse');pad();}});
addEventListener('pointerup',e=>{if(e.button===0){held.delete('mouse');pad();}});
addEventListener('keydown',e=>{if(e.repeat)return;if(e.code==='Space'||e.code==='ShiftLeft'){e.preventDefault();if(!worker){start();return;}held.add(e.code);pad();}});
addEventListener('keyup',e=>{if(held.delete(e.code))pad();});
