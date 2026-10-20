// Shared build-time/browser-import trace. No audio contexts or rendering are created.
import {loadGame} from './runtime.mjs';
export async function traceTimeline(base,load){
 // One run of the level with these inputs: [tick, input type] pairs in tick order, or 'auto' to
 // answer every cue on its tick as it appears.
 const key=(t,input)=>`${Math.round(t*1e4)}:${input}`;
 async function run(presses=[],unscored=new Set(),found=new Set()){
  const g=await loadGame(base,load,{timeline:false});g.options.chartAudioScheduled=true;
  const limit=Math.ceil(g.secondsAtTick(48*1000)*60);let next=0;const answered=[];
  for(let frame=0;!g.ended;frame++){
   if(frame>=limit)throw new Error('Chart did not end within 1000 beats');
   const tick=g.tickAtSeconds((frame+1)/60);let press=false;
   const pressed=[];
   if(presses==='auto'){
    for(let i=next;i<g.cues.length;i++)if(!answered[i]&&!g.cueWithdrawn[i]&&tick>=g.cues[i]){
     answered[i]=true;if(!unscored.has(key(g.cues[i],g.cueInputs[i]))){press=g.cueInputs[i];pressed.push(i);}
    }
    while(answered[next]||g.cueWithdrawn[next])next++;
   }
   else if(next<presses.length&&tick>=presses[next][0])press=presses[next++][1];
   const events=g.step(tick,press);
   if(pressed.length&&!events.some(e=>e[0]===2&&e[1]<=1))for(const i of pressed)found.add(key(g.cues[i],g.cueInputs[i]));
  }
  return g;
 }
 const g=await run();
 // A hit can arm a further cue (Screwbot Factory's release after its press), so the cues come from
 // a run that answers each one on its tick, with the input its checker waits for.
 // A checker whose press scores nothing is not a cue either: Bossa Nova's partner's catch, where a
 // press only bumps the player's head (SE_BOSSA_MISS_HEAD). The run is repeated without pressing those.
 const unscored=new Set();let auto;
 for(;;){const found=new Set();auto=await run('auto',unscored,found);if(!found.size)break;for(const k of found)unscored.add(k);}
 const c=auto.cues.map((t,i)=>[t,auto.cueInputs[i]]).filter(([t,input],i)=>!auto.cueWithdrawn[i]&&t<=auto.tick&&!unscored.has(key(t,input))).sort((a,b)=>a[0]-b[0]),others=[];
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
