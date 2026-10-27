// Original grading instruction regression checks, independent reference predicates,
// and the complete results -> release-confirm -> epilogue -> library lifecycle.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {loadGame} from '../dist/engine/runtime.mjs';
// Only game folders: macOS adds a .DS_Store file to the folder when Finder opens it.
const manifests=await Promise.all((await readdir(new URL('../games/',import.meta.url),{withFileTypes:true})).filter(e=>e.isDirectory()).map(async ({name})=>JSON.parse(await readFile(new URL(`../games/${name}/game.json`,import.meta.url)))));
const ids=process.argv.slice(2).length?process.argv.slice(2):manifests.filter(m=>m.web.enabled).map(m=>m.id);
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
 const g=await load(id);
 // The rhythm test grades nothing: it has no criteria, results or epilogue.
 if(g.manifest.wii.calibration){console.log(`${id}: no grading (rhythm test)`);continue;}
 const cp=g.u32(0x8032016c),criteria=Array.from({length:g.u8(cp+0xc4)},(_,i)=>{
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
 // Night Walk has no results screen (wii.results false): the level ends on the credits, so the
 // through grouping and result flow checks below do not apply.
 if(manifests.find(m=>m.id===id).wii.results===false)continue;
 // A good category beside a weak one exercises the But/follow distinction,
 // which is not covered by single-category threshold sweeps.
 for(let weak=0;weak<criteria.length;weak++)for(let hits=0;hits<=100;hits+=10){
  const states=criteria.map((_,i)=>({total:100,hits:i===weak?hits:100,misses:i===weak?100-hits:0,through:0}));
  states.forEach((s,i)=>{const p=cp+4+i*20;g.w16(p,s.total);g.w16(p+2,s.hits);g.w16(p+4,s.misses);g.w16(p+6,s.through);});
  const actual=g.result(),expected=referenceGrade(criteria,states);
  assert.equal(actual.grade,expected.grade);assert.equal(actual.but,expected.but);
  if(expected.grade===2&&criteria.length>1)assert.ok(actual.follow,'good category must produce the original positive follow-up');
 }
 // Through forgiveness is consumed once per group, not once per raw miss.
 const grouping=await load(id),manager=grouping.u32(0x8032016c),call=(fn,b=0,c=0)=>grouping.core._invoke_original(fn,manager,b,c,0,0,0,0);
 grouping.w32(manager+0xcc,2);call(0x801eaf2c,0,2);call(0x801eaf2c,0,2);
 assert.equal(grouping.u32(manager+0xcc),1);assert.equal(grouping.u16(manager+4),0);
 grouping.core._set_delta(61);call(0x801eae20);call(0x801eaf2c,0,2);
 assert.equal(grouping.u32(manager+0xcc),0);assert.equal(grouping.u16(manager+4),0);
 call(0x801eae20);call(0x801eaf2c,0,2);assert.equal(grouping.u16(manager+4),1);
 grouping.w8(manager+0xdd,0);call(0x801eaf2c,0,0);assert.equal(grouping.u16(manager+4),1);
 grouping.w8(manager+0xdd,1);grouping.w32(manager+0xcc,0);call(0x801eaea4);
 grouping.core._invoke_original(0x801eb10c,manager,0,0,0,60,0,0);
 call(0x801eaf2c,0,2);grouping.core._set_delta(59.9999);call(0x801eae20);call(0x801eaf2c,0,2);
 assert.equal(grouping.u16(manager+4),1,'through just inside the original 60-tick interval stays grouped');
 grouping.core._set_delta(.0002);call(0x801eae20);call(0x801eaf2c,0,2);assert.equal(grouping.u16(manager+4),2);
 call(0x801eaea4);grouping.core._invoke_original(0x801eb10c,manager,0,0,0,60,0,0);
 call(0x801eaf2c,0,2);grouping.core._set_delta(60);call(0x801eae20);call(0x801eaf2c,0,2);
 assert.equal(grouping.u16(manager+4),2,'the exact original interval boundary begins a new group');
 // Fresh full games; do not use the synthetic grading state for gameplay tests.
 for(const auto of [false,true]){
  const game=await load(id);let frame=0,cue=0;
  while(!game.ended){const tick=game.tickAtSeconds(++frame/60),press=auto&&tick>=game.timeline.cues[cue]?game.timeline.cueInputs?.[cue++]??true:false;game.step(tick,press);}
  const result=game.result();assert.equal(result.grade,auto?0:2);
  // Sneaky Spirits' original misses do not set the diagnostic Perfect-fail
  // flag (also covered by test-runtime); they still produce Try Again.
  assert.equal(result.perfectFailed,auto||id==='agbghost'?0:2);
  assert.ok(result.comments.length>0);assert.ok(result.comments.every(s=>s&&!s.includes('???')));
  game.startGrading();
  const events=[];
  for(let phase=0;phase<3;phase++){
   let n=0;do{events.push(...game.stepGrading(phase>0&&n===0));assert.ok(++n<1800,'result flow must reach its next wait/end');}while(!(game.core._grading_state()&17));
   assert.ok(game.core._grading_state()&(phase<2?1:16));
   if(phase===0){
    game.core._grading_input(1);
    for(let held=0;held<10;held++)events.push(...game.stepGrading());
    assert.ok(game.core._grading_state()&1,'holding A must remain on the grading screen');
    game.core._grading_input(0);
   }
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
