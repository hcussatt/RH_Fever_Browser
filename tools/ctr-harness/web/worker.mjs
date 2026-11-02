// Runs the translated game. Each vblank the game hands over its top screen and the audio mixed since
// the last one (see web.c); the worker sends the audio straight to the page's AudioWorklet and
// waits while the worklet holds more than AHEAD samples, so the game runs on the audio clock.
import createModule from './blanco.mjs';
import {createGpu} from './gl.mjs';
let AHEAD=1100; // game samples (32728 Hz) queued ahead of the speakers: ~34 ms, about two vblanks
let drawnCount=0,t0=performance.now(),audio,queued=0,wake=null,pad=0,frames=0;
// Input timing: the time (ms since the epoch) of the latest button change, the page's speaker
// latency, and an extra delay the player can set. A change reaches the game with its age as heard:
// the audio still queued, the speaker latency and the time since the key, which the game's own
// input queue then judges that much earlier (see input_age_ms in run.c).
let snapRange=null,perf=false,lastEnd=0,lastTick=0,clock=false,padAt=0,outputLatency=0,extraDelay=0,ageSent=0;
const env={INTERLEAVE:'1',GSP:'1',GAME:'67',START:'200',HWAKE:'1',WORKERS:'all,tramp,gsp'};
onmessage=async({data})=>{
  if(data.type==='pad'){pad=data.pad;padAt=data.at;}
  if(data.type==='latency')outputLatency=data.ms;
  if(data.type!=='start')return;
  audio=data.port;extraDelay=+(data.delay||0);outputLatency=data.latency||0;clock=!!data.env.clock;delete data.env.clock;perf=!!data.env.perf;delete data.env.perf;if(data.env.snap){snapRange=data.env.snap.split('-').map(Number);delete data.env.snap;}if(data.env.ahead){AHEAD=+data.env.ahead;delete data.env.ahead;}
  const gpu=data.canvas?createGpu(data.canvas,data.shaders||{},(key,src)=>postMessage({type:'shader',key,src})):null;if(gpu)env.GL='1';
  audio.onmessage=({data})=>{queued=data.queued;if(wake&&queued<=AHEAD){const w=wake;wake=null;w();}};
  const list=(await (await fetch('files.txt')).text()).split('\n').filter(Boolean);
  const files=await Promise.all(list.map(async f=>[f,new Uint8Array(await (await fetch('data/'+f)).arrayBuffer())]));
  const Module=await createModule({
    print:t=>console.log(t),printErr:t=>console.log(t),
    // Each judged input's offset from its cue (ms, late is positive), shown on the page.
    onJudge:(ms,kind)=>postMessage({type:'judge',ms,kind,tick:lastTick}),
    preRun:[m=>Object.assign(m.ENV,env,data.env)],
    hostLatency:()=>Math.round(Math.max(0,queued/32728*1000+outputLatency+extraDelay)*10),
    async hostVblank(rgb,drawn,samples,n,cmd,ncmd,vtx,tick){tick/=1000;lastTick=tick;
      // ?snap=from-to: the presented picture of every 3rd vblank in that tick range goes to the page (tests)
      if(gpu&&snapRange){gpu.snap.want=tick>=snapRange[0]&&tick<=snapRange[1]&&frames%3===0;gpu.snap.got=px=>postMessage({type:'snap',tick,px},[px.buffer]);}
      const tA=performance.now();if(gpu&&ncmd)gpu.run(Module.HEAPU8,cmd,ncmd,vtx);
      // ?perf=1: report slow vblanks (game time since the last one, GPU time, new shaders and textures)
      if(perf){const tB=performance.now(),game=tA-lastEnd;if(game+tB-tA>20)postMessage({type:'perf',at:tB,tick:lastTick,game,gpu:tB-tA,compiles:gpu?.stats.compiles,uploads:gpu?.stats.uploads,skipped:gpu?.stats.skipped});}
      frames++;if(frames%120===0)postMessage({type:'status',text:`vblank ${frames}, ${((performance.now()-t0)/1000).toFixed(1)} s, audio queued ${queued|0}, drawn ${drawnCount}`});
      if(n){const pcm=Module.HEAP16.slice(samples>>1,(samples>>1)+n*2);queued+=n;audio.postMessage(pcm,[pcm.buffer]);}
      if(drawn){drawnCount++;const src=Module.HEAPU8.subarray(rgb,rgb+400*240*3),px=new Uint8ClampedArray(400*240*4);
        for(let i=0,j=0;i<px.length;i+=4,j+=3){px[i]=src[j];px[i+1]=src[j+1];px[i+2]=src[j+2];px[i+3]=255;}
        postMessage({type:'frame',px,frames},[px.buffer]);}
      if(queued>AHEAD)await new Promise(r=>wake=r);
      const now=performance.timeOrigin+performance.now(),age=padAt?Math.max(0,now-padAt+queued/32728*1000+outputLatency+extraDelay):0;
      // Tests (?clock=1) get the song tick of the next game frame and when it reaches the speakers.
      lastEnd=performance.now();if(clock&&tick)postMessage({type:'clock',tick,at:now+queued/32728*1000+outputLatency});
      return pad|Math.min(Math.round(age*10),1<<22)<<8;
    }});
  for(const [f,bytes] of files){Module.FS.mkdirTree(f.slice(0,f.lastIndexOf('/')));Module.FS.writeFile(f,bytes);}
  postMessage({type:'status',text:'running'});
  try{await Module.callMain(['0x100000']);}catch(e){postMessage({type:'status',text:'stopped: '+e});}
};
