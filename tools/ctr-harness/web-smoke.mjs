// Runs the browser build in Node (no page): loads build/ctr/web/, plays SECS seconds of game time as
// fast as it can, and reports the speed and the audio it made (DSPWAV-style raw s16le to OUT if set).
// Usage: node tools/ctr-harness/web-smoke.mjs   (SECS=20 OUT=/tmp/web.raw; needs a Node with JSPI, 24 or later)
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const dir=new URL('../../build/ctr/web/',import.meta.url);
const {default:createModule}=await import(new URL('blanco.mjs',dir));
const secs=+(process.env.SECS||20),out=process.env.OUT;if(out)writeFileSync(out,'');
let frames=0,drawn=0,samples=0;const t0=performance.now();
const Module=await createModule({print:t=>console.log(t),printErr:t=>{if(!/^(worker|ControlMemory|CreateThread|start game|save )/.test(t))console.log(t);},
  preRun:[m=>Object.assign(m.ENV,{INTERLEAVE:'1',GSP:'1',GAME:'67',START:'200',HWAKE:'1',WORKERS:'all,tramp,gsp'})],
  async hostVblank(rgb,d,ptr,n){frames++;drawn+=!!d;samples+=n;
    if(out&&n)appendFileSync(out,Module.HEAPU8.slice(ptr,ptr+n*4));
    if(frames%300===0)console.log(`vblank ${frames}: ${(samples/32728).toFixed(1)} s of audio in ${((performance.now()-t0)/1000).toFixed(1)} s`);
    if(samples>=secs*32728){console.log(`done: ${frames} vblanks, ${drawn} drawn, ${(samples/32728).toFixed(1)} s audio, ${((performance.now()-t0)/1000).toFixed(1)} s wall`);process.exit(0);}
    return 0;}});
for(const f of readFileSync(new URL('files.txt',dir),'utf8').split('\n').filter(Boolean)){Module.FS.mkdirTree(f.slice(0,f.lastIndexOf('/')));Module.FS.writeFile(f,readFileSync(new URL('data/'+f,dir)));}
await Module.callMain(['0x100000']);
