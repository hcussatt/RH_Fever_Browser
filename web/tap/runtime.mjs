import createCore from './tap-core.mjs';
export async function loadTap(read=async name=>new Uint8Array(await (await fetch(new URL('assets/'+name,import.meta.url))).arrayBuffer())) {
 const json=async n=>JSON.parse(new TextDecoder().decode(await read(n)));
 const [assets,segments,timeline,core]=await Promise.all([json('original-assets.json'),json('original-segments.json'),json('original-timeline.json'),createCore()]);
 core._reset_runtime();
 const base=core._ram_ptr()-0x80000000;
 const view=new DataView(core.HEAPU8.buffer);
 const offset=a=>a+base;
 const u8=a=>view.getUint8(offset(a)),u16=a=>view.getUint16(offset(a)),u32=a=>view.getUint32(offset(a)),f32=a=>view.getFloat32(offset(a));
 const w8=(a,x)=>view.setUint8(offset(a),x),w16=(a,x)=>view.setUint16(offset(a),x),w32=(a,x)=>view.setUint32(offset(a),x),wf=(a,x)=>view.setFloat32(offset(a),x);
 const alloc=n=>core._allocate(n)>>>0;
 await Promise.all(segments.map(async s=>core.HEAPU8.set(await read(s.file),offset(s.address))));
 const banks=[assets.banks.agb_tap,assets.banks.agb_tap_bg];
 banks[255]={texture:0,cells:[[]],animations:Array.from({length:256},()=>[{cell:0,frames:1,x:0,y:0,scaleX:1,scaleY:1,angle:0,alpha:255}])};
 banks.forEach((b,id)=>{
  const ap=alloc(b.animations.length*8),cp=alloc(b.cells.length*8);
  b.animations.forEach((keys,i)=>{const p=alloc(keys.length*24);w16(ap+i*8,keys.length);w32(ap+i*8+4,p);keys.forEach((k,j)=>{const a=p+j*24;w16(a,k.cell);w16(a+2,k.frames);w16(a+4,k.x);w16(a+6,k.y);wf(a+8,k.scaleX);wf(a+12,k.scaleY);wf(a+16,k.angle);w8(a+20,k.alpha);});});
  b.cells.forEach((objects,i)=>{const p=alloc(objects.length*32);w16(cp+i*8,objects.length);w32(cp+i*8+4,p);objects.forEach((o,j)=>{const a=p+j*32;[o.sx,o.sy,o.w,o.h,o.palette,o.reserved,o.x,o.y].forEach((v,k)=>w16(a+k*2,v));wf(a+16,o.scaleX);wf(a+20,o.scaleY);wf(a+24,o.angle);w8(a+28,o.flipX);w8(a+29,o.flipY);w8(a+30,o.alpha);});});
  core._install_bank(id,b.animations.length,ap,cp);
 });
 core._initialize_scene();
 const arg=alloc(128);let eventIndex=0,tick=0;
 const sounds=[];const options={chartAudioScheduled:false};
 function drain(){const n=core._events_count(),p=core._events_ptr();const out=[];for(let i=0;i<n;i++)out.push(Array.from(core.HEAPU32.subarray(p/4+i*4,p/4+i*4+4)));core._events_clear();return out;}
 function command(e){
  if(e.op>=0x200){e.args.forEach((a,i)=>w32(arg+i*4,a));core._original_command(e.op,e.arg0,arg);}
  else if(e.op===0x42)core._set_input_allowed(e.args[0]);
  else if(e.op===0x12a)core._set_perfect_active(e.arg0);
  else if(e.op===0x23&&!options.chartAudioScheduled)sounds.push(e.args[0]);
 }
 for(const e of timeline.prelude)command(e);
 drain();core._set_perfect_active(1);
 function secondsAtTick(tick){let time=0;for(const s of timeline.tempoSegments){const ticks=s.beats*48;if(tick<=ticks)return time+tick/ticks*s.samples/s.rate;time+=s.samples/s.rate;tick-=ticks;}const s=timeline.tempoSegments.at(-1);return time+tick/(s.beats*48)*s.samples/s.rate;}
 function tickAtSeconds(time){let ticks=0;for(const s of timeline.tempoSegments){const seconds=s.samples/s.rate;if(time<=seconds)return ticks+time/seconds*s.beats*48;ticks+=s.beats*48;time-=seconds;}const s=timeline.tempoSegments.at(-1);return ticks+time/(s.samples/s.rate)*s.beats*48;}
 function step(nextTick,press=false){
  core._set_delta(nextTick-tick);
  core._set_tempo((nextTick-tick)*60/48);
  core._begin_frame();
  while(eventIndex<timeline.events.length&&timeline.events[eventIndex].tick<nextTick)command(timeline.events[eventIndex++]);
  if(press)core._press_a();
  core._finish_frame();tick=nextTick;
  const events=drain();for(const e of events)if(e[0]===1)sounds.push(e[1]);
  return events;
 }
 return {core,options,assets,secondsAtTick,tickAtSeconds,banks,timeline,step,drain,sounds,u8,u16,u32,f32,w8,w16,w32,wf,alloc,offset,get tick(){return tick;},get eventIndex(){return eventIndex;}};
}
