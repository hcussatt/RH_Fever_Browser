import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {loadTap} from '../dist/tap/runtime.mjs';
const g=await loadTap(n=>readFile(new URL('../dist/tap/assets/'+n,import.meta.url)));
console.log('init',g.core._pool_count(),g.drain());
const delay=Number(process.argv.find(x=>x.startsWith('--offset='))?.split('=')[1]||0);let frame=0;const auto=process.argv.includes('--auto');const targets=g.timeline.events.filter(e=>e.op===512).map(e=>e.tick+48+delay);let ti=0;let judgments=[];const sounds=[];
try {for(;frame<Math.ceil(g.secondsAtTick(g.timeline.endTick)*60);frame++){const tick=g.tickAtSeconds((frame+1)/60);const press=auto&&ti<targets.length&&tick>=targets[ti];if(press)ti++;judgments.push(...g.step(tick,press).filter(e=>e[0]===2));for(const sid of g.sounds)sounds.push({sid,time:(frame+1)/60});g.sounds.length=0;if(frame%600===0)console.log('frame',frame,'tick',g.tick,'actors',g.core._pool_count(),'stats',Array.from({length:9},(_,i)=>g.core._stat(i)));}}
catch(e){console.error('failed frame',frame,'tick',g.tick,'event',g.eventIndex,g.timeline.events[g.eventIndex-1]);throw e;}
console.log('judgments',judgments);
console.log('done',Array.from({length:9},(_,i)=>g.core._stat(i)));

if(auto&&delay===0)await writeFile(new URL('../dist/tap/qa/autoplay-sounds.json',import.meta.url),JSON.stringify(sounds)+'\n');

const stats=Array.from({length:9},(_,i)=>g.core._stat(i));
if(auto&&delay===0)assert.deepEqual(stats.slice(0,5),[102,0,0,0,0]);
if(!auto)assert.deepEqual(stats.slice(0,5),[0,0,102,0,2]);
if(auto&&delay===24){assert.equal(stats[0]+stats[1]+stats[2],102);assert.ok(stats[2]>0);assert.notEqual(stats[4],0);}
