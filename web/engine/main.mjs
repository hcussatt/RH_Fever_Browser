// The game page: boots one game from its folder, runs the frame loop on the
// audio clock, and reports the end-of-song result.
import {loadGame} from './runtime.mjs';
import {createAudio} from './audio.mjs';
import {createRenderer} from './renderer.mjs';
import {createResults} from './results.mjs';
import {A,createInputQueue,bindControls} from './input.mjs';
import {createTrack} from './clock.mjs';
import {assetResponse,requireAssets} from './assets.mjs';
import {getDelayMs,setDelayMs,measureDelay} from './delay.mjs';
import {skipPractice} from './practice.mjs';
const gameUrl=new URL('./',location.href);
const canvas=document.querySelector('canvas'),overlay=document.querySelector('#overlay'),play=document.querySelector('#play'),status=document.querySelector('#status');
let g,renderer,audio,music,practice,startTime,running=false,frame=0,sfx,paused=false,results,resultsStart,phase='game',track,backing,multiplayer,needsReset=false;const input=createInputQueue(),metrics=[];
// Crash log: every runtime error is kept in this browser's storage with the game, frame and chart
// tick, so a reload does not lose it. rhf.crashLog() returns it; after a crash the page offers it
// as a file.
const CRASH_LOG='rhf-crash-log';
function crashLog(){try{return JSON.parse(localStorage.getItem(CRASH_LOG)||'[]');}catch{return [];}}
function logCrash(e,kind){
 const entry={time:new Date().toISOString(),page:location.pathname,kind,phase,frame,tick:g?.tick??null,message:String(e?.message??e),stack:String(e?.stack??''),userAgent:navigator.userAgent};
 try{localStorage.setItem(CRASH_LOG,JSON.stringify([...crashLog(),entry].slice(-20)));}catch{}
 return entry;
}
addEventListener('error',e=>logCrash(e.error??e.message,'uncaught'));
addEventListener('unhandledrejection',e=>logCrash(e.reason,'unhandled rejection'));
// Debug and QA handle (tests and audio checks read it).
window.rhf={crashLog};
function fail(e){
 multiplayer?.interrupt('Runtime error interrupted the round.');
 running=false;audio?.suspend();overlay.hidden=false;play.disabled=true;play.textContent='Runtime error';status.textContent=e.message;console.error(e);window.rhf.error=e.stack;
 logCrash(e,'runtime error');
 if(!overlay.querySelector('#crash-log')){
  const a=Object.assign(document.createElement('a'),{id:'crash-log',download:'rhf-crash-log.json',textContent:'Save crash log'});a.style.color='#d2ded5';
  a.onclick=()=>{a.href=URL.createObjectURL(new Blob([JSON.stringify(crashLog(),null,2)],{type:'application/json'}));};
  overlay.append(a);
 }
}
try{
 await requireAssets(gameUrl.pathname.split('/').filter(Boolean).at(-1));
 const context=new AudioContext({latencyHint:'interactive'});audio=context;
 const musicData=assetResponse(new URL('assets/music.wav',gameUrl)).then(r=>r.arrayBuffer()).then(b=>audio.decodeAudioData(b));
 g=await loadGame(gameUrl);
 const {title,action}=g.manifest;document.title=title;canvas.setAttribute('aria-label',title+' game');
 document.querySelector('h1').textContent=title;
 // What the cues wait for: A (4), A and B together (6), or both in a remix.
 const inputs=new Set(g.timeline.cueInputs);
 const controls=!inputs.has(6)?'Space / X / click / controller A · '+action:!inputs.has(4)?`A + B together · ${action} (A: Space / Left Shift / click / controller A, B: Right Shift / right click / controller B)`:`${action} · A: Space / X / Left Shift / click / controller A · B: Right Shift / right click / controller B · some cues need A + B together`;for(const e of document.querySelectorAll('.controls'))e.textContent=controls+' · Start / Escape: pause';
 renderer=await createRenderer(g,canvas);renderer.draw();music=await musicData;sfx=await createAudio(audio,gameUrl,{envelope:g.envelope});
 results=g.manifest.wii.results===false?null:await createResults(g,canvas);
 practice=g.chart.practice&&!skipPractice()&&!(window.parent!==window&&new URLSearchParams(location.search).get('lobby')==='1')?await loadPractice():null;
 window.rhf={g,renderer,audio,sfx,results,inputs:input.presses,metrics,heardTime,stats:g.stats,result:null,crashLog,get startTime(){return startTime;},get track(){return track;},get phase(){return phase;},get practice(){return practice;},get frame(){return frame;}};
 play.disabled=false;play.textContent='Play';
 const embedded=window.parent!==window&&new URLSearchParams(location.search).get('lobby')==='1';
 let session;
 multiplayer={get active(){return embedded;},get peer(){return session;},attach:peer=>{session=peer;},game:()=>g,gameUrl,prepare:async()=>{
  if(document.hidden)throw new Error('Keep the game tab visible before pressing Ready.');
  await audio.resume();
  if(needsReset){
   sfx.stop();pending.length=0;voiced.length=0;input.presses.length=0;frame=0;phase='game';paused=false;window.rhf.result=null;
   g=await loadGame(gameUrl);renderer=await createRenderer(g,canvas);results=g.manifest.wii.results===false?null:await createResults(g,canvas);
   sfx.master.disconnect();sfx=await createAudio(audio,gameUrl,{envelope:g.envelope});
   Object.assign(window.rhf,{g,renderer,sfx,results,stats:g.stats});renderer.draw();
  }
  needsReset=true;
 },start:at=>{overlay.hidden=true;start(at).catch(fail);},stop:()=>{
  running=false;paused=false;sfx.stop();audio.suspend();overlay.hidden=false;play.textContent='Multiplayer — use Ready';
 },snapshot:()=>{const s=g.stats();return {hits:s[0],misses:s[1],through:s[2],stray:s[3],perfectFailed:s[4],position:running?Math.max(0,heardTime()-startTime):0};},finish:r=>session?.finish(r),interrupt:reason=>session?.interrupt(reason)};
 if(embedded){
  document.body.dataset.embedded='true';play.textContent='Waiting for lobby';status.textContent='Private versus';
  document.querySelector('a[href="../"]').hidden=true;
 }else{
  const lobby=document.createElement('a');lobby.id='multiplayer';lobby.textContent='Multiplayer lobby';lobby.href=new URL('../#multiplayer',gameUrl);document.querySelector('footer').insertBefore(lobby,status);
 }
 window.rhf.multiplayer=multiplayer;
}catch(e){fail(e);}
// Every sound plays at its chart tick on the audio clock: the chart's own sounds from the build's
// silent run and the live ones (a hit's or a miss's response, the scene's own), each handed to
// the audio thread a little ahead. A speed change moves the ticks still to come, so sounds not
// started yet are handed over again at their new time.
const LOOKAHEAD=.3;
const pending=[],voiced=[];
// In practice the chart keeps its own tempo: a tick is as far from the frame just run as the
// practice's rate makes it.
const atTick=tick=>phase==='practice'?startTime+frame/60+(tick-g.tick)/Math.max(1,g.practiceRate()):startTime+track.wallAt(g.secondsAtTick(tick));
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
 if(phase==='practice')g.speeds.length=0;
 for(const c of g.speeds)changeSpeed(c);g.speeds.length=0;
 pending.push(...g.sounds);g.sounds.length=0;
 schedule();
 for(const {target,op} of g.tunes){if(target.voice)applyTune(target,op);else if(pending.includes(target))(target.ops||=[]).push(op);}g.tunes.length=0;
 for(const v of g.musicVolumes)backing?.volume(v.volume,v.frames,atTick(v.tick));g.musicVolumes.length=0;
}
// Time of the audio the player is hearing now, on the AudioContext clock, less the delay the
// rhythm test measured beyond what the browser reports (see delay.mjs).
const delay=getDelayMs()/1000;
function heardTime(){
 const t=audio.getOutputTimestamp?.();
 // A stamp from the future (its clock base disagrees with this page's) is ignored, not trusted.
 const age=t?performance.now()-t.performanceTime:-1;
 if(t&&t.performanceTime>0&&age>=0&&age<100)return Math.min(audio.currentTime,t.contextTime+age/1000)-delay;
 return audio.currentTime-(audio.outputLatency||0)-(audio.baseLatency||0)-delay;
}
// The rhythm test (wii.calibration): each beat its signal sound plays on (the part played by ear,
// not the visual timer's) keeps the offset of the first A press within half a beat of it.
const beatOffsets=new Map();
function measurePress(heard){
 const tick=g.tickAtSeconds(track.posAt(Math.max(0,heard-startTime))),{cues,sounds}=g.timeline,signal=g.manifest.wii.calibration.signalSound;let beat=null;
 for(const cue of cues)if(Math.abs(cue-tick)<=24&&sounds.some(s=>s.sound===signal&&Math.abs(s.tick-cue)<2)&&(beat==null||Math.abs(cue-tick)<Math.abs(beat-tick)))beat=cue;
 if(beat!=null&&!beatOffsets.has(beat))beatOffsets.set(beat,g.secondsAtTick(tick)-g.secondsAtTick(beat));
}
// An input belongs to the first frame after the audio heard when it happened, as the original
// reads the controller once a frame. That frame runs as soon as its time is heard, not at the
// next screen refresh, so the game's answer (a hit sound) is not held back by up to a frame.
function press(button,down,at=performance.now()){
 if(!running||heardTime()<startTime)return;
 if(phase==='results'){if(button===A)results.input(down);return;}
 const heard=heardTime()-Math.max(0,performance.now()-at)/1000;
 if(g.manifest.wii.calibration&&button===A&&down)measurePress(heard);
 const due=Math.max(frame+1,Math.floor(Math.max(0,heard-startTime)*60)+1);
 input.push(due,button,down,at);runWhenHeard(due);
}
function runWhenHeard(due){
 if(!running||phase==='results'||frame>=due)return;
 const wait=(startTime+due/60-heardTime())*1000;
 if(wait>0)setTimeout(()=>runWhenHeard(due),wait+.5);else advance(Math.floor((heardTime()-startTime)*60));
}
// Runs the game up to this frame.
function advance(target){
 if(phase==='practice'){
  while(frame<target&&!g.practiceDone){frame++;g.step(g.tick+g.practiceRate()/60,input.take(frame));practiceMusic();liveEvents();}
  return;
 }
 while(frame<target&&!g.ended){frame++;
  const pressed=input.take(frame);
  g.step(g.tickAtSeconds(track.posAt(frame/60)),pressed);
  liveEvents();
 }
}
const pollGamepad=bindControls(canvas,{press,
 pause(){if(running)pause();else if(paused)play.click();},
 skip(){if(phase!=='practice'||!running)return false;endPractice().catch(fail);return true;},
 start(){if(!running&&!play.disabled){if(audio?.state==='suspended'&&navigator.userActivation&&!navigator.userActivation.hasBeenActive){status.textContent='Click Play once to enable controller audio.';return true;}play.click();return true;}return false;}});
// Controls remain active on the Play and Resume overlays, independent of simulation.
function pollControllers(){pollGamepad();requestAnimationFrame(pollControllers);}
requestAnimationFrame(pollControllers);
// The practice (chart.practice): its own session, loaded with the page, played before the song
// unless the player turned it off in game select (practice.mjs). Its backing waves loop while it
// repeats; it ends where the original would start the main chart, which then plays as without it.
async function loadPractice(){
 const p=await loadGame(gameUrl,undefined,{practice:true});
 const waves=new Map(await Promise.all(g.chart.practice.waves.map(async sound=>{
  const [buffer,info]=await Promise.all([assetResponse(new URL(`assets/practice-${sound}.wav`,gameUrl)).then(r=>r.arrayBuffer()).then(b=>audio.decodeAudioData(b)),assetResponse(new URL(`assets/practice-${sound}.json`,gameUrl)).then(r=>r.json())]);
  return [sound,{buffer,info}];
 })));
 return {g:p,renderer:await createRenderer(p,canvas),waves,main:null};
}
function practiceMusic(){
 for(const m of g.practiceMusic){
  if(m.sound!=null){backing?.source.stop();const w=practice.waves.get(m.sound);if(!w)throw new Error('Missing practice wave '+m.sound);backing=sfx.playMusic(w.buffer,Math.max(audio.currentTime,atTick(m.tick)),w.info);}
  else if(backing)sfx.stopWave(backing.source,atTick(m.tick),m.stop);
 }
 g.practiceMusic.length=0;
}
document.querySelector('#skip').onclick=()=>{if(phase==='practice'&&running)endPractice().catch(fail);};
function startPractice(){
 practice.main={g,renderer};g=practice.g;renderer=practice.renderer;Object.assign(window.rhf,{g,renderer,stats:g.stats});
 phase='practice';frame=0;backing=null;startTime=audio.currentTime+.1;document.querySelector('#skip').hidden=false;
 running=true;requestAnimationFrame(loop);
}
// The practice is over: the song starts from its own lead-in, as when the practice is skipped.
function endPractice(){
 if(phase!=='practice')return Promise.resolve();
 document.querySelector('#skip').hidden=true;running=false;sfx.stop();pending.length=0;voiced.length=0;input.presses.length=0;
 ({g,renderer}=practice.main);practice=null;Object.assign(window.rhf,{g,renderer,stats:g.stats});
 phase='game';frame=0;status.textContent='';
 return start();
}
// Starts the song. A later versus mode calls this when both players are ready.
async function start(at){
 needsReset=true;
 // A scene can sound a lead-in before the music (Double Date's count-in from tick -144), so the
 // music waits for it.
 const first=Math.min(0,...g.timeline.sounds.map(s=>s.tick),...g.sounds.map(s=>s.tick));
 startTime=at===undefined?audio.currentTime+.1-g.secondsAtTick(first):heardTime()+(at-performance.now())/1000;track=createTrack();backing=sfx.playMusic(music,startTime);
 // A remix's entry chart first plays its mode sound (SE_REMIX_MODE_SET_REMIXn, silent), which sets
 // the sequence variable the games' remix sounds read (see tools/chart-index.py). Then the chart's
 // own sounds, then the scene's setup and lead-in sounds (before the music start).
 pending.push(...(g.chart.preludeSounds||[]).map(sound=>({sound,tick:null})),...g.timeline.sounds);g.options.chartAudioScheduled=true;liveEvents();
 running=true;window.rhf.source=backing.source;requestAnimationFrame(loop);
}
play.onclick=async()=>{
 if(play.disabled||multiplayer?.active)return;play.disabled=true;
 try{await audio.resume();play.disabled=false;overlay.hidden=true;if(paused){paused=false;running=true;requestAnimationFrame(loop);return;}if(practice)startPractice();else await start();}catch(e){fail(e);}
};
document.querySelector('#restart').onclick=()=>{if(multiplayer?.active){multiplayer.interrupt('Restart interrupted the round.');return;}location.reload();};
// The original chart owns the outro; a longer backing wave must not delay grading.
const endSeconds=()=>g.secondsAtTick(g.ended?Math.min(g.endTick,g.timeline.endTick):g.timeline.endTick);
function finish(){
 // Night Walk has no results: it ends on the staff credits, which the port leaves out.
 if(!results){
  if(g.manifest.wii.calibration){const ms=measureDelay([...beatOffsets.values()],delay*1000);if(ms!=null)setDelayMs(ms);}
  running=false;sfx.stop();audio.suspend();const result=g.result();window.rhf.result=result;
  window.dispatchEvent(new CustomEvent('rhf-result',{detail:result}));multiplayer?.finish(result);
  if(!multiplayer?.active)location.href=new URL('../',gameUrl).href;return;
 }
 phase='results';resultsStart=atTick(g.timeline.endTick);
 const result=results.begin(sfx,resultsStart);window.rhf.result=result;status.textContent='';
 window.dispatchEvent(new CustomEvent('rhf-result',{detail:result}));
 multiplayer?.finish(result);
}
function loop(){if(!running)return;try{
 if(phase==='results'){
  results.draw(heardTime()-resultsStart);
  if(results.done){running=false;sfx.stop();audio.suspend();if(!multiplayer?.active)location.href=new URL('../',gameUrl).href;return;}
  requestAnimationFrame(loop);return;
 }
 if(phase==='practice'){
  advance(Math.floor(Math.max(0,heardTime()-startTime)*60));schedule();renderer.draw();
  // The original shows an A button beside a line that waits for it; the port names it here.
  status.textContent=g.practiceWaiting()?'Practice · press A to go on':'Practice';
  if(g.practiceDone){endPractice().catch(fail);return;}
  requestAnimationFrame(loop);return;
 }
 const began=performance.now();const elapsed=Math.max(0,heardTime()-startTime);
 const target=Math.floor(elapsed*60);
 advance(target);
 schedule();
 renderer.draw();metrics.push({frame,ms:performance.now()-began,catchUp:Math.max(0,target-frame)});
 if(track.posAt(elapsed)>=endSeconds())finish();
 requestAnimationFrame(loop);
 }catch(e){fail(e);}}

async function pause(){if(multiplayer?.active){multiplayer.interrupt('Pause or hidden tab interrupted the round.');return;}if(!running)return;running=false;paused=true;await audio.suspend();overlay.hidden=false;play.textContent='Resume';}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||multiplayer?.peer?.localReady))pause();});
