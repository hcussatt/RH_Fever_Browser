// Shared build-time/browser-import trace. No audio contexts or rendering are created.
import {loadGame} from './runtime.mjs';
export async function traceTimeline(base,load){
 // One run of the level with these inputs: [tick, input type] pairs in tick order, or 'auto' to
 // answer every cue on its tick as it appears.
 async function run(presses=[]){
  const g=await loadGame(base,load,{timeline:false});g.options.chartAudioScheduled=true;
  const limit=Math.ceil(g.secondsAtTick(48*1000)*60);let next=0;
  for(let frame=0;!g.ended;frame++){
   if(frame>=limit)throw new Error('Chart did not end within 1000 beats');
   const tick=g.tickAtSeconds((frame+1)/60);let press=false;
   if(presses==='auto'){for(;next<g.cues.length&&tick>=g.cues[next];next++)press=g.cueInputs[next];}
   else if(next<presses.length&&tick>=presses[next][0])press=presses[next++][1];
   g.step(tick,press);
  }
  return g;
 }
 const g=await run();
 // A hit can arm a further cue (Screwbot Factory's release after its press), so the cues come from
 // a run that answers each one on its tick, with the input its checker waits for.
 const auto=await run('auto'),c=auto.cues.map((t,i)=>[t,auto.cueInputs[i]]).sort((a,b)=>a[0]-b[0]),others=[];
 // Game sounds a chart command plays are scheduled ahead when every run plays them alike: nobody
 // pressing, every cue hit, early, missed late, presses only between cues, every other cue hit.
 const shift=d=>c.map(([t,input])=>[t+d,input]),strays=c.slice(1).map(([t],i)=>[(t+c[i][0])/2,4]);
 for(const presses of [c,shift(-6),shift(14),strays,c.filter((p,i)=>i%2)])others.push((await run(presses)).gameSounds);
 const same=(a,b)=>a.sound===b.sound&&Math.abs(a.tick-b.tick)<.5&&a.volume===b.volume&&a.pitch===b.pitch&&a.pan===b.pan&&a.offset===b.offset;
 const gameSounds=g.gameSounds.filter(s=>others.every(list=>list.some(t=>same(s,t))));
 const round=x=>Math.round(x*1e4)/1e4;
 return {source:'Silent run of the unmodified SOME01 chart',endTick:round(g.endTick),
  sounds:[...g.chartSounds,...gameSounds].sort((a,b)=>a.tick-b.tick).map(({tick,...s})=>({tick:round(tick),...s})),
  commands:g.commands.map(c=>({tick:round(c.tick),op:c.op})),cues:c.map(([t])=>round(t)),cueInputs:c.map(([,input])=>input)};
}
