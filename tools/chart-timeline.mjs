// Silent dry run of one game's chart through the original interpreter, with nobody pressing.
//   node tools/chart-timeline.mjs <game>      (after tools/stage-web.sh <game>)
// Writes dist/<game>/assets/original-timeline.json: the chart's own sounds with their ticks, so
// the browser can schedule them ahead on the audio thread; the game commands with their ticks;
// each input checker's perfect tick (autoplay tests); and the tick where the song ends.
import {readFile,writeFile} from 'node:fs/promises';
import {loadGame} from '../dist/engine/runtime.mjs';
const id=process.argv[2];
const base=new URL(`../dist/${id}/`,import.meta.url);
const g=await loadGame(base,readFile,{timeline:false});
g.options.chartAudioScheduled=true;
const limit=Math.ceil(g.secondsAtTick(48*1000)*60);
for(let frame=0;!g.ended;frame++){
 if(frame>=limit)throw new Error(`${id}: chart did not end within 1000 beats`);
 g.step(g.tickAtSeconds((frame+1)/60));
}
const round=x=>Math.round(x*1e4)/1e4;
const timeline={
 source:'Silent run of the unmodified SOME01 chart',
 endTick:round(g.endTick),
 sounds:g.chartSounds.map(({tick,...s})=>({tick:round(tick),...s})),
 commands:g.commands.map(c=>({tick:round(c.tick),op:c.op})),
 cues:g.cues.map(round).sort((a,b)=>a-b),
};
await writeFile(new URL('assets/original-timeline.json',base),JSON.stringify(timeline)+'\n');
console.log(`${id}: end tick ${timeline.endTick}, ${timeline.sounds.length} chart sounds, ${timeline.cues.length} cues`);
