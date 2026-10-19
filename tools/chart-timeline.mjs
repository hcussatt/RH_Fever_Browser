// Trace the original chart with the same routine used by the browser importer.
import {readFile,writeFile} from 'node:fs/promises';
import {traceTimeline} from '../dist/engine/timeline.mjs';
const id=process.argv[2],base=new URL(`../dist/${id}/`,import.meta.url);
const timeline=await traceTimeline(base,readFile);
await writeFile(new URL('assets/original-timeline.json',base),JSON.stringify(timeline)+'\n');
console.log(`${id}: end tick ${timeline.endTick}, ${timeline.sounds.length} scheduled sounds, ${timeline.cues.length} cues`);
