// Silent dry runs of one game's chart through the original interpreter.
//   node tools/chart-timeline.mjs <game>      (after tools/stage-web.sh <game>)
// Writes dist/<game>/assets/original-timeline.json: the chart's own sounds with their ticks, so
// the browser can schedule them ahead on the audio thread; the game commands with their ticks;
// each input checker's perfect tick (autoplay tests); and the tick where the song ends.
import {readFile,writeFile} from 'node:fs/promises';
import {loadGame} from '../dist/engine/runtime.mjs';
const id=process.argv[2];
const base=new URL(`../dist/${id}/`,import.meta.url);
// One run of the level, pressing at these ticks.
async function run(presses=[]){
 const g=await loadGame(base,readFile,{timeline:false});
 g.options.chartAudioScheduled=true;
 const limit=Math.ceil(g.secondsAtTick(48*1000)*60);let next=0;
 for(let frame=0;!g.ended;frame++){
  if(frame>=limit)throw new Error(`${id}: chart did not end within 1000 beats`);
  const tick=g.tickAtSeconds((frame+1)/60),press=next<presses.length&&tick>=presses[next];if(press)next++;
  g.step(tick,press);
 }
 return g;
}
const g=await run();
// Game sounds a chart command plays (the ghost's steps, a monkey getting ready) are scheduled ahead
// like the chart's own when every run plays them alike: nobody pressing, every cue hit, every cue
// pressed early, every cue missed late, presses only between cues, and every other cue hit. The
// rest depend on the player and play live.
const c=g.cues,others=[];
for(const presses of [c,c.map(t=>t-6),c.map(t=>t+14),c.slice(1).map((t,i)=>(t+c[i])/2),c.filter((t,i)=>i%2)])others.push(await run(presses));
const same=(a,b)=>a.sound===b.sound&&Math.abs(a.tick-b.tick)<.5&&a.volume===b.volume&&a.pitch===b.pitch&&a.pan===b.pan&&a.offset===b.offset;
const gameSounds=g.gameSounds.filter(s=>others.every(o=>o.gameSounds.some(t=>same(s,t))));
const round=x=>Math.round(x*1e4)/1e4;
const timeline={
 source:'Silent run of the unmodified SOME01 chart',
 endTick:round(g.endTick),
 sounds:[...g.chartSounds,...gameSounds].sort((a,b)=>a.tick-b.tick).map(({tick,...s})=>({tick:round(tick),...s})),
 commands:g.commands.map(c=>({tick:round(c.tick),op:c.op})),
 cues:g.cues.map(round).sort((a,b)=>a-b),
};
await writeFile(new URL('assets/original-timeline.json',base),JSON.stringify(timeline)+'\n');
console.log(`${id}: end tick ${timeline.endTick}, ${g.chartSounds.length} chart sounds, ${gameSounds.length} of ${g.gameSounds.length} game sounds ahead, ${timeline.cues.length} cues`);
