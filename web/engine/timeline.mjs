// Shared build-time/browser-import trace. No audio contexts or rendering are created.
import {loadGame} from './runtime.mjs';
export async function traceTimeline(base,load){
 async function run(presses=[]){
  const g=await loadGame(base,load,{timeline:false});g.options.chartAudioScheduled=true;
  const limit=Math.ceil(g.secondsAtTick(48*1000)*60);let next=0;
  for(let frame=0;!g.ended;frame++){
   if(frame>=limit)throw new Error('Chart did not end within 1000 beats');
   const tick=g.tickAtSeconds((frame+1)/60),press=next<presses.length&&tick>=presses[next];if(press)next++;
   g.step(tick,press);
  }
  return g;
 }
 const g=await run(),c=g.cues,others=[];
 for(const presses of [c,c.map(t=>t-6),c.map(t=>t+14),c.slice(1).map((t,i)=>(t+c[i])/2),c.filter((t,i)=>i%2)])others.push((await run(presses)).gameSounds);
 const same=(a,b)=>a.sound===b.sound&&Math.abs(a.tick-b.tick)<.5&&a.volume===b.volume&&a.pitch===b.pitch&&a.pan===b.pan&&a.offset===b.offset;
 const gameSounds=g.gameSounds.filter(s=>others.every(list=>list.some(t=>same(s,t))));
 const round=x=>Math.round(x*1e4)/1e4;
 return {source:'Silent run of the unmodified SOME01 chart',endTick:round(g.endTick),
  sounds:[...g.chartSounds,...gameSounds].sort((a,b)=>a.tick-b.tick).map(({tick,...s})=>({tick:round(tick),...s})),
  commands:g.commands.map(c=>({tick:round(c.tick),op:c.op})),cues:g.cues.map(round).sort((a,b)=>a-b)};
}
