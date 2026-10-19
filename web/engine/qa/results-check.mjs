// Silent, reproducible full results/epilogue render. OfflineAudioContext never
// connects to speakers. Run from a built game page, passing that game's URL.
import {loadGame} from '../runtime.mjs';
import {createResults} from '../results.mjs';
import {createAudio} from '../audio.mjs';
export async function checkResults(gameUrl,{mode='centered'}={}){
 const g=await loadGame(gameUrl);let frame=0,cue=0;const categories=new Map();
 while(!g.ended){
  const tick=g.tickAtSeconds(++frame/60);let press=false;
  if(tick>=g.timeline.cues[cue]){
   press=mode==='centered'||mode==='ok'&&cue%4!==0||mode==='but'&&cue%12!==0||mode==='follow'&&categories.get(cue)===1;cue++;
  }
  for(const e of g.step(tick,press?g.timeline.cueInputs?.[cue-1]??true:false))if(e[0]===9){
   const at=g.tick+g.f32(e[1]+0x58)-g.f32(e[1]+0x54),i=g.timeline.cues.findIndex(t=>Math.abs(t-at)<.5);categories.set(i,g.u8(e[1]+0x78));
  }
 }
 const rate=48000,context=new OfflineAudioContext(2,20*rate,rate),adapter=await createAudio(context,gameUrl,{envelope:g.envelope});
 let now=0;const audio={play:(sid,when,tune)=>adapter.play(sid,when??now,tune),playWave:adapter.playWave,stopWave:adapter.stopWave,stopAt:adapter.stopAt};
 const canvas=document.createElement('canvas');canvas.width=854;canvas.height=480;
 const scene=await createResults(g,canvas),result=scene.begin(audio,0);
 scene.draw(10);if(!scene.ready)throw new Error('No grading input wait');
 now=10;scene.input(true);scene.input(false);scene.draw(14);if(!scene.ready)throw new Error('No epilogue input wait');
 now=14;scene.input(true);scene.input(false);scene.draw(20);if(!scene.done)throw new Error('Result flow did not end');
 const buffer=await context.startRendering();let peak=0,clips=0,nonfinite=0,sum=0;
 for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const x of buffer.getChannelData(ch)){peak=Math.max(peak,Math.abs(x));if(Math.abs(x)>=1)clips++;if(!Number.isFinite(x))nonfinite++;sum+=x*x;}
 if(clips||nonfinite||adapter.telemetry.unknown.length)throw new Error('Invalid result audio: '+JSON.stringify({peak,clips,nonfinite,unknown:adapter.telemetry.unknown}));
 return {game:g.manifest.id,mode,result,frames:frame,peak,clippedSamples:clips,nonfiniteSamples:nonfinite,rms:Math.sqrt(sum/(buffer.length*buffer.numberOfChannels)),unknownSounds:adapter.telemetry.unknown,voices:adapter.telemetry.played,originalEvents:scene.events.filter(e=>[20,21,23,16,18].includes(e.kind))};
}
