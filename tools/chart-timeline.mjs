// Silent dry runs of one game's chart through the original interpreter.
//   node tools/chart-timeline.mjs <game>      (after tools/stage-web.sh <game>)
// Writes dist/<game>/assets/original-timeline.json: the chart's own sounds with their ticks, so
// the browser can schedule them ahead on the audio thread; the game commands with their ticks;
// each input checker's perfect tick (autoplay tests); and the tick where the song ends.
import {readFile,writeFile} from 'node:fs/promises';
import {loadGame} from '../dist/engine/runtime.mjs';
const id=process.argv[2];
const base=new URL(`../dist/${id}/`,import.meta.url);
// One run of the level with these inputs: [tick, input type] pairs in tick order, or 'auto' to
// answer every cue on its tick as it appears.
async function run(presses=[]){
 const g=await loadGame(base,readFile,{timeline:false});
 g.options.chartAudioScheduled=true;
 const limit=Math.ceil(g.secondsAtTick(48*1000)*60);let next=0;
 for(let frame=0;!g.ended;frame++){
  if(frame>=limit)throw new Error(`${id}: chart did not end within 1000 beats`);
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
const auto=await run('auto'),c=auto.cues.map((t,i)=>[t,auto.cueInputs[i]]).sort((a,b)=>a[0]-b[0]);
// Game sounds a chart command plays (the ghost's steps, a monkey getting ready) are scheduled ahead
// like the chart's own when every run plays them alike: nobody pressing, every cue hit, every cue
// pressed early, every cue missed late, presses only between cues, and every other cue hit. The
// rest depend on the player and play live.
const others=[];
const shift=d=>c.map(([t,input])=>[t+d,input]),strays=c.slice(1).map(([t],i)=>[(t+c[i][0])/2,4]);
for(const presses of [c,shift(-6),shift(14),strays,c.filter((p,i)=>i%2)])others.push(await run(presses));
const same=(a,b)=>a.sound===b.sound&&Math.abs(a.tick-b.tick)<.5&&a.volume===b.volume&&a.pitch===b.pitch&&a.pan===b.pan&&a.offset===b.offset;
const gameSounds=g.gameSounds.filter(s=>others.every(o=>o.gameSounds.some(t=>same(s,t))));
const round=x=>Math.round(x*1e4)/1e4;
const timeline={
 source:'Silent run of the unmodified SOME01 chart',
 endTick:round(g.endTick),
 sounds:[...g.chartSounds,...gameSounds].sort((a,b)=>a.tick-b.tick).map(({tick,...s})=>({tick:round(tick),...s})),
 commands:g.commands.map(c=>({tick:round(c.tick),op:c.op})),
 cues:c.map(([t])=>round(t)),
 cueInputs:c.map(([,input])=>input),
};
await writeFile(new URL('assets/original-timeline.json',base),JSON.stringify(timeline)+'\n');
console.log(`${id}: end tick ${timeline.endTick}, ${g.chartSounds.length} chart sounds, ${gameSounds.length} of ${g.gameSounds.length} game sounds ahead, ${timeline.cues.length} cues`);
