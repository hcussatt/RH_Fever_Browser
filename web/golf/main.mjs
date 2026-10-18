import {loadGolf} from './runtime.mjs';
import {createAudio} from './audio.mjs';
import {createRenderer} from './renderer.mjs';
const canvas=document.querySelector('canvas'),overlay=document.querySelector('#overlay'),play=document.querySelector('#play'),status=document.querySelector('#status');
let g,renderer,audio,music,startTime,running=false,frame=0,lastPad=false,sfx,paused=false;const inputs=[],metrics=[];
window.golf={};
function fail(e){running=false;audio?.suspend();overlay.hidden=false;play.disabled=true;play.textContent='Runtime error';status.textContent=e.message;console.error(e);window.golf.error=e.stack;}
try{
 const context=new AudioContext({latencyHint:'interactive'});audio=context;
 const musicData=fetch('assets/music.wav').then(r=>r.arrayBuffer()).then(b=>audio.decodeAudioData(b));
 g=await loadGolf();renderer=await createRenderer(g,canvas);renderer.draw();music=await musicData;sfx=await createAudio(audio);
 window.golf={g,renderer,audio,sfx,inputs,metrics,heardTime,stats:()=>Array.from({length:9},(_,i)=>g.core._stat(i)),get frame(){return frame;}};
 play.disabled=false;play.textContent='Play';
}catch(e){fail(e);}
function soundEvents(){for(const sid of g.sounds)sfx.play(sid);g.sounds.length=0;}
function heardTime(){
 const t=audio.getOutputTimestamp?.();
 if(t&&t.performanceTime>0&&performance.now()-t.performanceTime<100)return Math.min(audio.currentTime,t.contextTime+(performance.now()-t.performanceTime)/1000);
 return audio.currentTime-(audio.outputLatency||0)-(audio.baseLatency||0);
}
function press(){if(!running)return;inputs.push({at:performance.now(),frame:Math.max(frame+1,Math.floor(Math.max(0,heardTime()-startTime)*60)+1),done:false});}
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!e.repeat){e.preventDefault();if(running)pause();else if(paused)play.click();return;}if(['Space','KeyX'].includes(e.code)){e.preventDefault();if(!e.repeat){if(!running&&!play.disabled)play.click();else press();}}});
canvas.addEventListener('pointerdown',e=>{e.preventDefault();press();});
play.onclick=async()=>{
 if(play.disabled)return;play.disabled=true;
 try{await audio.resume();play.disabled=false;overlay.hidden=true;if(paused){paused=false;running=true;requestAnimationFrame(loop);return;}const source=audio.createBufferSource();source.buffer=music;const gain=audio.createGain();gain.gain.value=.55;source.connect(gain).connect(audio.destination);startTime=audio.currentTime+.1;source.start(startTime);for(const e of g.timeline.events)if(e.op===0x23)sfx.play(e.args[0],startTime+e.tick*g.timeline.secondsPerTick);g.options.chartAudioScheduled=true;g.sounds.length=0;running=true;window.golf.source=source;requestAnimationFrame(loop);}catch(e){fail(e);}
};
document.querySelector('#restart').onclick=()=>location.reload();
function loop(){if(!running)return;try{
 const pad=Array.from(navigator.getGamepads?.()||[]).find(Boolean),down=!!pad?.buttons[0]?.pressed;if(down&&!lastPad)press();lastPad=down;
 const began=performance.now();const elapsed=Math.max(0,heardTime()-startTime);
 const target=Math.floor(elapsed*60);
 while(frame<target){frame++;
  let pressed=false;for(const i of inputs)if(!i.done&&i.frame<=frame){pressed=true;i.done=true;i.processed=performance.now();i.delayMs=i.processed-i.at;}
  g.step(frame/60/g.timeline.secondsPerTick,pressed);
  // Chart cues were scheduled on the audio thread before playback started.
  // Only gameplay-dependent sounds are emitted here.
  soundEvents();
 }
 renderer.draw();metrics.push({frame,ms:performance.now()-began,catchUp:Math.max(0,target-frame)});
 if(elapsed>=g.timeline.endTick*g.timeline.secondsPerTick){running=false;status.textContent=`${g.core._stat(0)} hits · ${g.core._stat(1)} misses · ${g.core._stat(2)} through`;overlay.hidden=false;play.textContent='Play again';play.onclick=()=>location.reload();}
 else requestAnimationFrame(loop);
 }catch(e){fail(e);}}

async function pause(){if(!running)return;running=false;paused=true;await audio.suspend();overlay.hidden=false;play.textContent='Resume';}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)pause();});
