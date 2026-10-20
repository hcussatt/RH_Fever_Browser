// Checks that web/engine/sequence.mjs traces every sequence sound of each built game into the
// notes tools/extract-sfx.py gives it (globals at -1, no user procedure, random variables at 0).
//   node tests/test-sequence.mjs [game...]
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {traceSequence} from '../web/engine/sequence.mjs';
const dist=new URL('../dist/',import.meta.url);
const ids=process.argv.slice(2).length?process.argv.slice(2):(await readdir(dist,{withFileTypes:true})).filter(d=>d.isDirectory()&&d.name!=='engine').map(d=>d.name);
const close=(a,b)=>typeof a==='number'&&typeof b==='number'?Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a)):a===b;
function same(a,b,path){
 if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),path);for(const k of Object.keys(a))same(a[k],b[k],path+'.'+k);}
 else assert.ok(close(a,b),`${path}: ${a} != ${b}`);
}
for(const id of ids){
 let data;try{data=JSON.parse(await readFile(new URL(`${id}/assets/sfx.json`,dist)));}catch{continue;}
 const files={};let count=0;
 for(const [sid,s] of Object.entries(data.sounds)){
  if(!s.sequence)continue;
  const seq=files[s.sequence.file]??=new Uint8Array(await readFile(new URL(`${id}/assets/${s.sequence.file}`,dist)));
  same(traceSequence(seq,s.sequence.start,s.sequence.bank,data,new Array(16).fill(-1),{},()=>0),s.notes,`${id} ${sid}`);count++;
 }
 console.log(id,count,'sequence sounds match');
}
