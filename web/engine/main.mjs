// The game page: boots one game from its folder, runs the frame loop on the
// audio clock, and reports the end-of-song result.
import {loadGame} from './runtime.mjs';
import {createAudio} from './audio.mjs';
import {createRenderer} from './renderer.mjs';
import {createInputQueue,bindControls} from './input.mjs';
const gameUrl=new URL('./',location.href);
const canvas=document.querySelector('canvas'),overlay=document.querySelector('#overlay'),play=document.querySelector('#play'),status=document.querySelector('#status');
let g,renderer,audio,music,startTime,running=false,frame=0,sfx,paused=false;const input=createInputQueue(),metrics=[];
// Debug and QA handle (tests and audio checks read it).
window.rhf={};
function fail(e){running=false;audio?.suspend();overlay.hidden=false;play.disabled=true;play.textContent='Runtime error';status.textContent=e.message;console.error(e);window.rhf.error=e.stack;}
try{
 const context=new AudioContext({latencyHint:'interactive'});audio=context;
 const musicData=fetch(new URL('assets/music.wav',gameUrl)).then(r=>r.arrayBuffer()).then(b=>audio.decodeAudioData(b));
 g=await loadGame(gameUrl);
 const {title,action}=g.manifest;document.title=title;canvas.setAttribute('aria-label',title+' game');
 document.querySelector('h1').textContent=title;for(const e of document.querySelectorAll('.controls'))e.textContent='Space / X / click · '+action;
 renderer=await createRenderer(g,canvas);renderer.draw();music=await musicData;sfx=await createAudio(audio,gameUrl);
 window.rhf={g,renderer,audio,sfx,inputs:input.presses,metrics,heardTime,stats:g.stats,result:null,get frame(){return frame;}};
 play.disabled=false;play.textContent='Play';
}catch(e){fail(e);}
function soundEvents(){for(const sid of g.sounds)sfx.play(sid);g.sounds.length=0;}
// Time of the audio the player is hearing now, on the AudioContext clock.
function heardTime(){
 const t=audio.getOutputTimestamp?.();
 if(t&&t.performanceTime>0&&performance.now()-t.performanceTime<100)return Math.min(audio.currentTime,t.contextTime+(performance.now()-t.performanceTime)/1000);
 return audio.currentTime-(audio.outputLatency||0)-(audio.baseLatency||0);
}
function press(){if(!running)return;input.push(Math.max(frame+1,Math.floor(Math.max(0,heardTime()-startTime)*60)+1));}
const pollGamepad=bindControls(canvas,{press,
 pause(){if(running)pause();else if(paused)play.click();},
 start(){if(!running&&!play.disabled){play.click();return true;}return false;}});
// Starts the song. A later versus mode calls this when both players are ready.
async function start(){
 const source=audio.createBufferSource();source.buffer=music;const gain=audio.createGain();gain.gain.value=.55;source.connect(gain).connect(audio.destination);startTime=audio.currentTime+.1;source.start(startTime);
 // Chart cues are scheduled on the audio thread before playback starts.
 for(const e of g.timeline.events)if(e.op===0x23)sfx.play(e.args[0],startTime+g.secondsAtTick(e.tick));g.options.chartAudioScheduled=true;g.sounds.length=0;running=true;window.rhf.source=source;requestAnimationFrame(loop);
}
play.onclick=async()=>{
 if(play.disabled)return;play.disabled=true;
 try{await audio.resume();play.disabled=false;overlay.hidden=true;if(paused){paused=false;running=true;requestAnimationFrame(loop);return;}await start();}catch(e){fail(e);}
};
document.querySelector('#restart').onclick=()=>location.reload();
const endSeconds=()=>g.manifest.wii.endsWithMusic?Math.max(music.duration,g.secondsAtTick(g.timeline.endTick)):g.secondsAtTick(g.timeline.endTick);
function finish(){
 running=false;const result=g.result();window.rhf.result=result;
 status.textContent=`${result.hits} hits · ${result.misses} misses · ${result.through} through`;overlay.hidden=false;play.textContent='Play again';play.onclick=()=>location.reload();
 window.dispatchEvent(new CustomEvent('rhf-result',{detail:result}));
}
function loop(){if(!running)return;try{
 pollGamepad();
 const began=performance.now();const elapsed=Math.max(0,heardTime()-startTime);
 const target=Math.floor(elapsed*60);
 while(frame<target){frame++;
  const pressed=input.take(frame);
  g.step(g.tickAtSeconds(frame/60),pressed);
  // Only gameplay-dependent sounds are emitted here.
  soundEvents();
 }
 renderer.draw();metrics.push({frame,ms:performance.now()-began,catchUp:Math.max(0,target-frame)});
 if(elapsed>=endSeconds())finish();
 else requestAnimationFrame(loop);
 }catch(e){fail(e);}}

async function pause(){if(!running)return;running=false;paused=true;await audio.suspend();overlay.hidden=false;play.textContent='Resume';}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)pause();});
