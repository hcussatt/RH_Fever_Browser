// The game page: boots one game from its folder, runs the frame loop on the
// audio clock, and reports the end-of-song result.
import {loadGame} from './runtime.mjs';
import {createAudio} from './audio.mjs';
import {createRenderer} from './renderer.mjs';
import {createResults} from './results.mjs';
import {createInputQueue,bindControls} from './input.mjs';
import {createTrack} from './clock.mjs';
import {assetResponse,requireAssets} from './assets.mjs';
const gameUrl=new URL('./',location.href);
const canvas=document.querySelector('canvas'),overlay=document.querySelector('#overlay'),play=document.querySelector('#play'),status=document.querySelector('#status');
let g,renderer,audio,music,startTime,running=false,frame=0,sfx,paused=false,results,resultsStart,phase='game',track,backing;const input=createInputQueue(),metrics=[];
// Debug and QA handle (tests and audio checks read it).
window.rhf={};
function fail(e){running=false;audio?.suspend();overlay.hidden=false;play.disabled=true;play.textContent='Runtime error';status.textContent=e.message;console.error(e);window.rhf.error=e.stack;}
try{
 await requireAssets(gameUrl.pathname.split('/').filter(Boolean).at(-1));
 const context=new AudioContext({latencyHint:'interactive'});audio=context;
 const musicData=assetResponse(new URL('assets/music.wav',gameUrl)).then(r=>r.arrayBuffer()).then(b=>audio.decodeAudioData(b));
 g=await loadGame(gameUrl);
 const {title,action}=g.manifest;document.title=title;canvas.setAttribute('aria-label',title+' game');
 document.querySelector('h1').textContent=title;for(const e of document.querySelectorAll('.controls'))e.textContent='Space / X / click · '+action;
 renderer=await createRenderer(g,canvas);renderer.draw();music=await musicData;sfx=await createAudio(audio,gameUrl,{envelope:g.envelope});
 results=await createResults(g,canvas);
 window.rhf={g,renderer,audio,sfx,results,inputs:input.presses,metrics,heardTime,stats:g.stats,result:null,get track(){return track;},get phase(){return phase;},get frame(){return frame;}};
 play.disabled=false;play.textContent='Play';
}catch(e){fail(e);}
// Every sound plays at its chart tick on the audio clock: the chart's own sounds from the build's
// silent run and the live ones (a hit's or a miss's response, the scene's own), each handed to
// the audio thread a little ahead. A speed change moves the ticks still to come, so sounds not
// started yet are handed over again at their new time.
const LOOKAHEAD=.3;
const pending=[],voiced=[];
const atTick=tick=>startTime+track.wallAt(g.secondsAtTick(tick));
function applyTune(s,op){sfx.tune(s.voice,op,atTick(op.tick));(s.applied||=[]).push(op);}
function schedule(){
 const horizon=audio.currentTime+LOOKAHEAD;
 for(let i=0;i<pending.length;){
  const s=pending[i],when=s.tick==null?audio.currentTime:atTick(s.tick);
  if(when>=horizon){i++;continue;}
  pending.splice(i,1);s.voice=sfx.play(s.sound,when,s);
  if(!s.voice)continue;
  const ops=s.ops||[];s.ops=null;for(const op of ops)applyTune(s,op);
  voiced.push(s);
 }
 for(let i=voiced.length-1;i>=0;i--)if(voiced[i].voice.start<=audio.currentTime)voiced.splice(i,1);
}
function changeSpeed({tick,speed}){
 if(speed===track.speed)return;
 // The track can only change from now on: until then it played at the old speed, and so did the chart.
 const wall=Math.max(track.wallAt(g.secondsAtTick(tick)),audio.currentTime-startTime+.005);
 track.set(wall,speed);backing.speed(speed,startTime+wall);
 for(let i=voiced.length-1;i>=0;i--){const s=voiced[i];if(s.tick!=null&&s.voice.start>startTime+wall&&sfx.cancel(s.voice)){voiced.splice(i,1);s.voice=null;s.ops=s.applied||null;s.applied=null;pending.push(s);}}
}
function liveEvents(){
 for(const c of g.speeds)changeSpeed(c);g.speeds.length=0;
 pending.push(...g.sounds);g.sounds.length=0;
 schedule();
 for(const {target,op} of g.tunes){if(target.voice)applyTune(target,op);else if(pending.includes(target))(target.ops||=[]).push(op);}g.tunes.length=0;
 for(const v of g.musicVolumes)backing.volume(v.volume,v.frames,atTick(v.tick));g.musicVolumes.length=0;
}
// Time of the audio the player is hearing now, on the AudioContext clock.
function heardTime(){
 const t=audio.getOutputTimestamp?.();
 if(t&&t.performanceTime>0&&performance.now()-t.performanceTime<100)return Math.min(audio.currentTime,t.contextTime+(performance.now()-t.performanceTime)/1000);
 return audio.currentTime-(audio.outputLatency||0)-(audio.baseLatency||0);
}
function press(){if(!running)return;if(phase==='results'){results.input(true);return;}input.push(Math.max(frame+1,Math.floor(Math.max(0,heardTime()-startTime)*60)+1));}
const pollGamepad=bindControls(canvas,{press,
 release(){if(running&&phase==='results')results.input(false);},
 pause(){if(running)pause();else if(paused)play.click();},
 start(){if(!running&&!play.disabled){play.click();return true;}return false;}});
// Starts the song. A later versus mode calls this when both players are ready.
async function start(){
 startTime=audio.currentTime+.1;track=createTrack();backing=sfx.playMusic(music,startTime);
 // The chart's own sounds, then the scene's setup and lead-in sounds (before the music start).
 pending.push(...g.timeline.sounds);g.options.chartAudioScheduled=true;liveEvents();
 running=true;window.rhf.source=backing.source;requestAnimationFrame(loop);
}
play.onclick=async()=>{
 if(play.disabled)return;play.disabled=true;
 try{await audio.resume();play.disabled=false;overlay.hidden=true;if(paused){paused=false;running=true;requestAnimationFrame(loop);return;}await start();}catch(e){fail(e);}
};
document.querySelector('#restart').onclick=()=>location.reload();
// The original chart owns the outro; a longer backing wave must not delay grading.
const endSeconds=()=>g.secondsAtTick(g.timeline.endTick);
function finish(){
 phase='results';resultsStart=atTick(g.timeline.endTick);
 const result=results.begin(sfx,resultsStart);window.rhf.result=result;status.textContent='';
 window.dispatchEvent(new CustomEvent('rhf-result',{detail:result}));
}
function loop(){if(!running)return;try{
 pollGamepad();
 if(phase==='results'){
  results.draw(heardTime()-resultsStart);
  if(results.done){running=false;sfx.stop();audio.suspend();location.href=new URL('../',gameUrl).href;return;}
  requestAnimationFrame(loop);return;
 }
 const began=performance.now();const elapsed=Math.max(0,heardTime()-startTime);
 const target=Math.floor(elapsed*60);
 while(frame<target&&!g.ended){frame++;
  const pressed=input.take(frame);
  g.step(g.tickAtSeconds(track.posAt(frame/60)),pressed);
  liveEvents();
 }
 schedule();
 renderer.draw();metrics.push({frame,ms:performance.now()-began,catchUp:Math.max(0,target-frame)});
 if(track.posAt(elapsed)>=endSeconds())finish();
 requestAnimationFrame(loop);
 }catch(e){fail(e);}}

async function pause(){if(!running)return;running=false;paused=true;await audio.suspend();overlay.hidden=false;play.textContent='Resume';}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)pause();});
