// Plays a whole level headlessly through the translated original code.
//   node tests/test-runtime.mjs <game> [--auto] [--offset=<ticks>]
// Without --auto nobody presses; with --auto every cue is pressed <offset> ticks late.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {loadGame} from '../dist/engine/runtime.mjs';
const id=process.argv[2];
const g=await loadGame(new URL(`../dist/${id}/`,import.meta.url),readFile);
console.log('init',g.core._pool_count(),g.drain());
const delay=Number(process.argv.find(x=>x.startsWith('--offset='))?.split('=')[1]||0);let frame=0;const auto=process.argv.includes('--auto');const targets=g.timeline.cues.map(t=>t+delay);let ti=0;let judgments=[];const sounds=[];
try {for(;frame<Math.ceil(g.secondsAtTick(g.timeline.endTick)*60);frame++){const tick=g.tickAtSeconds((frame+1)/60);const press=auto&&ti<targets.length&&tick>=targets[ti];if(press)ti++;judgments.push(...g.step(tick,press).filter(e=>e[0]===2));for(const sid of g.sounds)sounds.push({sid,time:(frame+1)/60});g.sounds.length=0;if(frame%600===0)console.log('frame',frame,'tick',g.tick,'actors',g.core._pool_count(),'stats',g.stats());}}
catch(e){console.error('failed frame',frame,'tick',g.tick);throw e;}
console.log('judgments',judgments);
console.log('done',g.stats());

if(auto&&delay===0){await mkdir(new URL(`../dist/${id}/qa/`,import.meta.url),{recursive:true});await writeFile(new URL(`../dist/${id}/qa/autoplay-sounds.json`,import.meta.url),JSON.stringify(sounds)+'\n');}

// Expected [hits, misses, through, stray, perfectFailed] for each game's cue count.
const stats=g.stats().slice(0,5),cues=targets.length;
const expected={golf:64,tap:102,rap:31}[id];
if(expected)assert.equal(cues,expected);
if(auto&&delay===0)assert.deepEqual(stats,[cues,0,0,0,0]);
if(!auto)assert.deepEqual(stats,[0,0,cues,0,2]);
if(id==='golf'&&auto&&delay===12)assert.deepEqual(stats,[0,0,64,64,2]);
if(id==='tap'&&auto&&delay===24){assert.equal(stats[0]+stats[1]+stats[2],102);assert.ok(stats[2]>0);assert.notEqual(stats[4],0);}
