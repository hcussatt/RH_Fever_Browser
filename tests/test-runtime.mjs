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
try {for(;frame<Math.ceil(g.secondsAtTick(g.timeline.endTick)*60);frame++){const tick=g.tickAtSeconds((frame+1)/60);const press=auto&&ti<targets.length&&tick>=targets[ti]?g.timeline.cueInputs?.[ti++]??true:false;judgments.push(...g.step(tick,press).filter(e=>e[0]===2));for(const {sound,tick,...tuning} of g.sounds)sounds.push({sid:sound,time:(frame+1)/60,...tuning});g.sounds.length=0;if(frame%600===0)console.log('frame',frame,'tick',g.tick,'actors',g.core._pool_count(),'stats',g.stats());}}
catch(e){console.error('failed frame',frame,'tick',g.tick);throw e;}
console.log('judgments',judgments);
console.log('done',g.stats());

if(auto&&delay===0){await mkdir(new URL(`../dist/${id}/qa/`,import.meta.url),{recursive:true});await writeFile(new URL(`../dist/${id}/qa/autoplay-sounds.json`,import.meta.url),JSON.stringify(sounds)+'\n');}

// Expected [hits, misses, through, stray, perfectFailed] for each game's cue count.
const stats=g.stats().slice(0,5),cues=targets.length;
const expected={golf:64,tap:102,rap:31,agbghost:12,robot:66,seesaw:60,date:59,remix1:54,rocket:41,concons:193,receive:163,remix6:130,bun:124,seal:40,badminton:120,muscle:111,remix3:168,karateman:183,panel:67,shrimp:144,taptroupe:235,remix7:175,fork:74,tambourine:70,rotation:15,watch:149,remix2:60,interview:45,sort:98,flea:139,samurai:64,remix4:93,fishing:40,goma:230,batting:12,birds:256,remix5:83,remix8:82,samurai2:64,bun2:69,seal2:48,date2:69,remix9:77,rap2:48,panel2:68,golf2:79,robot2:104,remix10:267,muscle2:115,flea2:147,sort2:95,karateman2:175,nightwalk:183}[id];
// Screwbot Factory's checkers each wait for a press and then a release: nobody pressing passes one cue per checker
// (Remix 1 has four of them). In Built to Scale a missed rod drops, so its later
// bounce and launch checkers never arm: nobody pressing passes one cue for each of its 16 rods (Remix 3 has 7 of them, 8 cues fewer; Remix 8 has 7 cues fewer; Built to Scale 2 has 24 rods).
// In Karate Man each of the 6 charged kicks' A+B is followed by 4 checkers that take no input (-1)
// and pass while A+B is let go: nobody pressing passes 4 more for each (Remix 7 has one kick; Remix 9 has one
// kick and four Screwbot checkers, so its count comes out even; Karate Man 2 has 15 kicks; Remix 10 has one
// kick and six Screwbot checkers, 2 fewer). With nobody pressing
// Night Walk's Play-Yan falls part-way, which ends the level (the credits start) after 52 cues.
const checkers={robot:33,remix1:50,seal:16,remix3:160,karateman:207,remix7:179,remix8:75,seal2:24,robot2:52,remix10:265,karateman2:235,nightwalk:52}[id]??cues;
if(expected)assert.equal(cues,expected);
if(auto&&delay===0)assert.deepEqual(stats,[cues,0,0,0,0]);
// Perfect-fail reports with nobody pressing (Sneaky Spirits' and Night Walk's misses report none).
if(!auto)assert.deepEqual(stats,[0,0,checkers,0,id==='agbghost'||id==='nightwalk'?0:2]);
if(id==='golf'&&auto&&delay===12)assert.deepEqual(stats,[0,0,64,64,2]);
if(id==='tap'&&auto&&delay===24){assert.equal(stats[0]+stats[1]+stats[2],102);assert.ok(stats[2]>0);assert.notEqual(stats[4],0);}
