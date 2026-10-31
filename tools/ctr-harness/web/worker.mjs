// Runs the translated game. Each vblank the game hands over its top screen and the audio mixed since
// the last one (see web.c); the worker sends the audio straight to the page's AudioWorklet and
// waits while the worklet holds more than AHEAD samples, so the game runs on the audio clock.
import createModule from './blanco.mjs';
const RATE=32728,AHEAD=1600; // ~49 ms of game audio queued ahead of the speakers
let drawnCount=0,t0=performance.now(),audio,queued=0,wake=null,pad=0,frames=0;
const env={INTERLEAVE:'1',GSP:'1',GAME:'67',START:'200',HWAKE:'1',WORKERS:'all,tramp,gsp'};
onmessage=async({data})=>{
  if(data.type==='pad')pad=data.pad;
  if(data.type!=='start')return;
  audio=data.port;
  audio.onmessage=({data})=>{queued=data.queued;if(wake&&queued<=AHEAD){const w=wake;wake=null;w();}};
  const list=(await (await fetch('files.txt')).text()).split('\n').filter(Boolean);
  const files=await Promise.all(list.map(async f=>[f,new Uint8Array(await (await fetch('data/'+f)).arrayBuffer())]));
  const Module=await createModule({
    print:t=>console.log(t),printErr:t=>console.log(t),
    preRun:[m=>Object.assign(m.ENV,env,data.env)],
    async hostVblank(rgb,drawn,samples,n){
      frames++;if(frames%120===0)postMessage({type:'status',text:`vblank ${frames}, ${((performance.now()-t0)/1000).toFixed(1)} s, audio queued ${queued|0}, drawn ${drawnCount}`});
      if(n){const pcm=Module.HEAP16.slice(samples>>1,(samples>>1)+n*2);queued+=n;audio.postMessage(pcm,[pcm.buffer]);}
      if(drawn){drawnCount++;const src=Module.HEAPU8.subarray(rgb,rgb+400*240*3),px=new Uint8ClampedArray(400*240*4);
        for(let i=0,j=0;i<px.length;i+=4,j+=3){px[i]=src[j];px[i+1]=src[j+1];px[i+2]=src[j+2];px[i+3]=255;}
        postMessage({type:'frame',px,frames},[px.buffer]);}
      if(queued>AHEAD)await new Promise(r=>wake=r);
      return pad;
    }});
  for(const [f,bytes] of files){Module.FS.mkdirTree(f.slice(0,f.lastIndexOf('/')));Module.FS.writeFile(f,bytes);}
  postMessage({type:'status',text:'running'});
  try{await Module.callMain(['0x100000']);}catch(e){postMessage({type:'status',text:'stopped: '+e});}
};
