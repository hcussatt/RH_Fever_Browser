// Loads one game's translated original code (WASM) and data into a session.
// Everything game-specific comes from the game's manifest (games/<id>/game.json);
// everything else is read from files the build extracted from the user's ISO.
import {createClock} from './clock.mjs';
const fetchBytes=async url=>new Uint8Array(await (await fetch(url)).arrayBuffer());
// gameUrl: the game's folder (dist/<id>/). load: url -> bytes (Node tests pass readFile).
// The chart runs live in the original interpreter. original-timeline.json is the build's silent
// dry run of it (chart sounds, cue ticks, end tick); the dry run itself loads with timeline:false.
export async function loadGame(gameUrl,load=fetchBytes,{timeline:withTimeline=true}={}) {
 const base=new URL(gameUrl);
 const json=async url=>JSON.parse(new TextDecoder().decode(await load(url)));
 const manifest=await json(new URL('game.json',base)),profile=manifest.wii;
 const read=name=>load(new URL('assets/'+name,base));
 const {default:createCore}=await import(new URL(`${manifest.id}-core.mjs`,base));
 const [assets,segments,chart,timeline,core]=await Promise.all([json(new URL('assets/original-assets.json',base)),json(new URL('assets/original-segments.json',base)),json(new URL('assets/original-chart.json',base)),withTimeline?json(new URL('assets/original-timeline.json',base)):null,createCore()]);
 const clock=createClock(chart);
 core._reset_runtime();
 const ramBase=core._ram_ptr()-0x80000000;
 const view=new DataView(core.HEAPU8.buffer);
 const offset=a=>a+ramBase;
 const u8=a=>view.getUint8(offset(a)),u16=a=>view.getUint16(offset(a)),u32=a=>view.getUint32(offset(a)),f32=a=>view.getFloat32(offset(a));
 const w8=(a,x)=>view.setUint8(offset(a),x),w16=(a,x)=>view.setUint16(offset(a),x),w32=(a,x)=>view.setUint32(offset(a),x),wf=(a,x)=>view.setFloat32(offset(a),x);
 const alloc=n=>core._allocate(n)>>>0;
 await Promise.all(segments.map(async s=>core.HEAPU8.set(await read(s.file),offset(s.address))));
 // Bank ids are the order the original scene registers them in.
 const banks=profile.banks.map(n=>assets.banks[n]);
 banks[255]={texture:0,cells:[[]],animations:Array.from({length:256},()=>[{cell:0,frames:1,x:0,y:0,scaleX:1,scaleY:1,angle:0,alpha:255}])};
 banks.forEach((b,id)=>{
  const ap=alloc(b.animations.length*8),cp=alloc(b.cells.length*8);
  b.animations.forEach((keys,i)=>{const p=alloc(keys.length*24);w16(ap+i*8,keys.length);w32(ap+i*8+4,p);keys.forEach((k,j)=>{const a=p+j*24;w16(a,k.cell);w16(a+2,k.frames);w16(a+4,k.x);w16(a+6,k.y);wf(a+8,k.scaleX);wf(a+12,k.scaleY);wf(a+16,k.angle);w8(a+20,k.alpha);});});
  b.cells.forEach((objects,i)=>{const p=alloc(objects.length*32);w16(cp+i*8,objects.length);w32(cp+i*8+4,p);objects.forEach((o,j)=>{const a=p+j*32;[o.sx,o.sy,o.w,o.h,o.palette,o.reserved,o.x,o.y].forEach((v,k)=>w16(a+k*2,v));wf(a+16,o.scaleX);wf(a+20,o.scaleY);wf(a+24,o.angle);w8(a+28,o.flipX);w8(a+29,o.flipY);w8(a+30,o.alpha);});});
  core._install_bank(id,b.animations.length,ap,cp);
 });
 core._initialize_scene();
 const f32bits=new DataView(new ArrayBuffer(4));
 const rest=bits=>(f32bits.setUint32(0,bits),f32bits.getFloat32(0));
 let tick=0,ended=false,endTick=null;
 const sounds=[],chartSounds=[],commands=[];const options={chartAudioScheduled:false};
 function drain(){const n=core._events_count(),p=core._events_ptr();const out=[];for(let i=0;i<n;i++)out.push(Array.from(core.HEAPU32.subarray(p/4+i*4,p/4+i*4+4)));core._events_clear();return out;}
 function frame(ticks,press){
  core._set_delta(ticks);core._set_frame_ticks(ticks);
  if(profile.chartTempo)core._set_tempo(ticks*60/48);
  core._begin_frame();
  if(press)core._press_a();
  core._finish_frame();
  return drain();
 }
 // Pre-roll: run the chart from its first command to the music start at the nominal tempo.
 // Music start is chart tick 0; the frame that reaches it ends -rest ticks past it.
 drain();core._start_chart(chart.start);
 const nominal=1/60/chart.secondsPerTick;
 for(let n=0;!(core._chart_state()&1);n++){
  if(n>=36000)throw new Error('Chart never started its music');
  const start=frame(nominal).find(e=>e[0]===6);
  if(start)tick=-rest(start[2]);
 }
 // Perfect campaign mode is chosen by the menus in the original, not by the chart.
 if(profile.perfectActive)core._set_perfect_active(1);
 // Events carry the issuing flow's rest; the command ran at the frame's end tick plus that rest.
 function step(nextTick,press=false){
  const events=frame(nextTick-tick,press);tick=nextTick;
  for(const e of events){
   if(e[0]===1||e[0]===5&&!options.chartAudioScheduled)sounds.push(e[1]);
   if(e[0]===5)chartSounds.push({tick:tick+rest(e[2]),sound:e[1]});
   else if(e[0]===8)commands.push({tick:tick+rest(e[2]),op:e[1]});
   else if(e[0]===7){ended=true;endTick=tick+rest(e[2]);}
  }
  return events;
 }
 // Judgment counters kept by the platform backend (adapters/wii/platform.c stat()).
 const stats=()=>Array.from({length:9},(_,i)=>core._stat(i));
 function result(){const s=stats();return {hits:s[0],misses:s[1],through:s[2],stray:s[3],perfectFailed:s[4]};}
 return {manifest,base,core,options,assets,chart,clock,secondsAtTick:clock.secondsAtTick,tickAtSeconds:clock.tickAtSeconds,banks,timeline,step,drain,sounds,chartSounds,commands,stats,result,u8,u16,u32,f32,w8,w16,w32,wf,alloc,offset,get tick(){return tick;},get ended(){return ended;},get endTick(){return endTick;}};
}
