import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {loadTap} from '../dist/tap/runtime.mjs';
const g=await loadTap(n=>readFile(new URL('../dist/tap/assets/'+n,import.meta.url)));
const c=g.alloc(512),quality=g.alloc(32);
const call=(a,b=c,d=0,e=0,h=0,f1=0)=>g.core._invoke_original(a,b,d,e,h,f1,0,0)>>>0;
const F=Math.fround;
let count=0;
function ref(age,window,narrow,finalized){
 if(finalized)return [2,0,false];
 const lag=F(F(age-48)-0),just=narrow?1:window,miss=narrow?4:10;
 if(lag>=-just&&lag<=just)return [0,Math.abs(lag)<=(just*2<=4?just:just/2)?100:95,true];
 if(lag>=-miss&&lag<=miss)return [1,80,true];
 return [2,0,false];
}
for(const window of [6])for(const narrow of [0,1])for(const finalized of [0,1]){
 const ages=new Set();
 for(let i=32*128;i<=64*128;i++)ages.add(F(i/128));
 // Float32 neighbors at each original judgment and quality boundary.
 for(const b of [-10,-window,-window/2,0,window/2,window,10]){
  const buf=new ArrayBuffer(4),v=new DataView(buf);v.setFloat32(0,48+b);const bits=v.getUint32(0);
  for(let k=-2;k<=2;k++){v.setUint32(0,bits+k);ages.add(v.getFloat32(0));}
 }
 for(const age of ages){
  call(0x801e7b40);g.wf(c+0x54,age);g.wf(c+0x58,48);g.wf(c+0x5c,-10);g.wf(c+0x60,-window);g.wf(c+0x64,window);g.wf(c+0x68,10);g.w8(c+0x71,finalized);g.w8(quality,0);
  const j=call(0x801e7eb0,c,quality,narrow),actual=[j,g.u8(quality),!!g.u8(c+0x71)],expected=ref(age,window,narrow,finalized);
  if(finalized)expected[2]=true;
  assert.deepEqual(actual,expected,JSON.stringify({age,window,narrow,finalized}));count++;
 }
}
// Original expiration update is strict >, and finalized misses cannot be recovered.
for(const age of [57.99999,58,58.00001]){
 call(0x801e7b40);g.wf(c+0x54,age);g.wf(c+0x58,48);g.wf(c+0x68,10);g.core._set_delta(0);call(0x801e7c24);assert.equal(!!g.u8(c+0x71),F(age)>58);if(F(age)>58)assert.equal(call(0x801e7eb0,c,quality,0,0,8),2);
}
const report={classifierCases:count,passed:true,reference:'independent JavaScript float32 transcription of matching recovered CInputChecker::_20',limits:['This validates the PPC-to-WASM classifier against recovered logic, not browser event phase against physical Wii input.','Perfect integration and full-level outcomes are covered separately.']};
console.log(JSON.stringify(report,null,2));await mkdir(new URL('../build/reports/',import.meta.url),{recursive:true});await writeFile(new URL('../build/reports/tap-timing-tests.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
