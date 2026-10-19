// Original grading instruction regression checks, independent reference predicates,
// and the complete results -> release-confirm -> epilogue -> library lifecycle.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadGame} from '../dist/engine/runtime.mjs';
const ids=process.argv.slice(2).length?process.argv.slice(2):['golf','tap','rap'];
const load=id=>loadGame(new URL(`../dist/${id}/`,import.meta.url),readFile);
const below=(threshold,count,percent)=>threshold&0x8000?percent<(threshold&0x7fff):count<threshold;
function referenceGrade(criteria,states){
 let bad=false,eligible=0,good=0;
 for(let i=0;i<criteria.length;i++){
  const c=criteria[i],s=states[i];if(!s.total)continue;
  const hitPercent=Math.floor(s.hits*100/s.total),throughPercent=Math.floor(s.through*100/s.total);
  if(!below(c.through,s.through,throughPercent)||below(c.minimum,s.hits,hitPercent))bad=true;
  if((c.superb&0x8000)&&(c.superb&0x7fff)>100)continue;
  eligible++;if(!s.through&&!below(c.superb,s.hits,hitPercent))good++;
 }
 return {grade:bad?2:eligible>0&&good===eligible?0:1,but:!bad&&good>0&&good!==eligible};
}
for(const id of ids){
 const g=await load(id),cp=g.u32(0x8032016c),criteria=Array.from({length:g.u8(cp+0xc4)},(_,i)=>{
  const p=g.u32(cp+0xa4+i*4);return{superb:g.u16(p+8),minimum:g.u16(p+10),through:g.u16(p+12)};
 });
 assert.ok(criteria.length>0,'chart must have installed its original criteria');
 let cases=0;
 // Sweep integer/percentage thresholds and strict through disqualification. The
 // original PPC code (including divw and mfcr) must agree at every boundary.
 for(let category=0;category<criteria.length;category++)for(let total=1;total<=120;total++)for(let hits=0;hits<=total;hits++){
  const states=criteria.map(()=>({total:0,hits:0,misses:0,through:0}));
  for(let through=0;through<=Math.min(1,total-hits);through++){
   states[category]={total,hits,misses:total-hits-through,through};
   states.forEach((s,i)=>{const p=cp+4+i*20;g.w16(p,s.total);g.w16(p+2,s.hits);g.w16(p+4,s.misses);g.w16(p+6,s.through);});
   const result=g.result(),expected=referenceGrade(criteria,states);
   assert.equal(result.grade,expected.grade,`${id} category ${category} ${JSON.stringify(states[category])}`);
   assert.equal(result.but,expected.but);cases++;
  }
 }
 console.log(`${id}: ${cases} grading boundary cases`);
 // Fresh full games; do not use the synthetic grading state for gameplay tests.
 for(const auto of [false,true]){
  const game=await load(id);let frame=0,cue=0;
  while(!game.ended){const tick=game.tickAtSeconds(++frame/60),press=auto&&tick>=game.timeline.cues[cue]?game.timeline.cueInputs?.[cue++]??true:false;game.step(tick,press);}
  const result=game.result();assert.equal(result.grade,auto?0:2);assert.equal(result.perfectFailed,auto?0:2);
  assert.ok(result.comments.length>0);assert.ok(result.comments.every(s=>s&&!s.includes('???')));
  game.startGrading();
  const events=[];
  for(let phase=0;phase<3;phase++){
   let n=0;do{events.push(...game.stepGrading(phase>0&&n===0));assert.ok(++n<1800,'result flow must reach its next wait/end');}while(!(game.core._grading_state()&17));
   assert.ok(game.core._grading_state()&(phase<2?1:16));
  }
  const revealed=events.filter(e=>e.kind===20&&e.value<=4).map(e=>e.value);
  assert.deepEqual(revealed,[0,1,2]);
  const heading=events.find(e=>e.kind===20&&e.value===0),comments=events.find(e=>e.kind===20&&e.value===1),grade=events.find(e=>e.kind===20&&e.value===2);
  assert.equal(comments.frame-heading.frame,90);assert.equal(grade.frame-comments.frame,135);
  assert.deepEqual(events.filter(e=>e.kind===21).map(e=>e.value),[auto?123:125,auto?126:128]);
  assert.equal(events.filter(e=>e.kind===1&&e.value===247).length,2);
  assert.equal(events.filter(e=>e.kind===1&&e.value===248).length,2);
  console.log(`${id} ${auto?'centered':'no input'}: grade ${result.grade}, original comments and complete result/epilogue flow`);
 }
}
