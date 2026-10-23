import {test} from 'node:test';
import assert from 'node:assert/strict';
import {A,B,bindControls} from '../web/engine/input.mjs';

test('controllers start, press A+B, hold, release, pause, resume and disconnect',()=>{
 const old={window:globalThis.window,navigator:globalThis.navigator,document:globalThis.document};
 let pads=[],hidden=false,canStart=true,starts=0,pauses=0;const events=[];
 globalThis.window={addEventListener(){}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>pads}});
 globalThis.document={get hidden(){return hidden;}};
 try{
  const poll=bindControls({addEventListener(){}},{press:(button,down)=>events.push([button,down]),pause:()=>pauses++,start:()=>{if(!canStart)return false;starts++;canStart=false;return true;}});
  const pad=(a=false,b=false,start=false)=>({buttons:Array.from({length:10},(_,i)=>({pressed:i===0?a:i===1?b:i===9?start:false}))});
  pads=[null,pad(true)];poll();poll();assert.equal(starts,1);assert.deepEqual(events,[]);
  pads=[pad()];poll();assert.deepEqual(events,[]);
  pads=[pad(true,true)];poll();poll();assert.deepEqual(events,[[A,true],[B,true]]);
  pads=[pad(false,true)];poll();assert.deepEqual(events.at(-1),[A,false]);
  pads=[];poll();assert.deepEqual(events.at(-1),[B,false]);
  pads=[pad(false,false,true)];poll();poll();assert.equal(pauses,1);
  pads=[pad()];poll();pads=[pad(false,false,true)];poll();assert.equal(pauses,2);
  pads=[pad()];poll();canStart=true;pads=[pad(true)];poll();assert.equal(starts,2);
  pads=[pad()];poll();const count=events.length;hidden=true;pads=[pad(true,true,true)];poll();assert.equal(events.length,count);assert.equal(pauses,2);
 }finally{
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:old.navigator});
 }
});
