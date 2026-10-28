// A game's practice, played headless from its first line to the song: every prompt answered,
// every cue hit, and free presses where a practice counts presses with no cue (Figure
// Fighter's punches; Karate Man and Samurai Slice want A+B held).
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadGame} from '../dist/engine/runtime.mjs';
// These practices end only when the player presses Skip, as in the original.
const WAITS_FOR_SKIP=new Set(['tambourine','receive']);
const LIMIT=60*300;
function play(g,heldPair,limit){
 let cue=0,lastPrompt=-99,lastPress=0,holding=false,f=0;
 for(;f<limit&&!g.practiceDone;f++){
  let press=0;
  if(g.practiceWaiting()&&f-lastPrompt>20){press=true;lastPrompt=f;}
  else if(cue<g.cues.length&&g.tick>=g.cues[cue]-g.practiceRate()/120){if(!g.cueWithdrawn[cue])press=g.cueInputs[cue];cue++;lastPress=f;}
  else if(holding&&f-lastPress>30){press=20;holding=false;lastPress=f;}
  else if(f-lastPress>40&&!g.cues.some((t,i)=>t>g.tick-24&&!g.cueWithdrawn[i])){press=heldPair?6:4;holding=heldPair;lastPress=f;}
  g.step(g.tick+g.practiceRate()/60,press);
  g.sounds.length=0;
 }
 return {done:g.practiceDone,seconds:f/60,music:g.practiceMusic.length};
}
for(const id of process.argv.slice(2)){
 const base=new URL(`../dist/${id}/`,import.meta.url);
 if(!JSON.parse(await readFile(new URL('assets/original-chart.json',base))).practice){console.log(`${id}: no practice`);continue;}
 const load=()=>loadGame(base,readFile,{practice:true});
 let g=await load();
 // A practice that waits for Skip only has to run its loop without a fault.
 let run=play(g,false,WAITS_FOR_SKIP.has(id)?60*60:LIMIT);
 if(!run.done&&!WAITS_FOR_SKIP.has(id)){g=await load();run=play(g,true,LIMIT);}
 if(WAITS_FOR_SKIP.has(id))assert.ok(!run.done,`${id}: practice should wait for Skip`);
 else assert.ok(run.done,`${id}: practice did not reach the song in ${LIMIT/60} s`);
 console.log(`${id}: practice ${run.done?'reached the song':'waits for Skip'} after ${run.seconds.toFixed(1)} s, ${run.music} music events`);
}
