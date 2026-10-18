import {createAudio} from '../audio.mjs';
export async function checkAudio(){
 const sampleRate=48000,context=new OfflineAudioContext(2,110*sampleRate,sampleRate);
 const [adapter,music,sounds]=await Promise.all([createAudio(context),fetch(new URL('../assets/music.wav',import.meta.url)).then(r=>r.arrayBuffer()).then(b=>context.decodeAudioData(b)),fetch(new URL('./autoplay-sounds.json',import.meta.url)).then(r=>r.json())]);
 const source=context.createBufferSource(),gain=context.createGain();source.buffer=music;gain.gain.value=.55;source.connect(gain).connect(context.destination);source.start(0);
 for(const e of sounds)adapter.play(e.sid,e.time);
 const output=await context.startRendering();let peak=0,clips=0,nonfinite=0,rms=0;
 for(let ch=0;ch<2;ch++)for(const x of output.getChannelData(ch)){peak=Math.max(peak,Math.abs(x));if(Math.abs(x)>=1)clips++;if(!Number.isFinite(x))nonfinite++;rms+=x*x;}
 return {sampleRate,seconds:output.duration,peak,clippedSamples:clips,nonfiniteSamples:nonfinite,rms:Math.sqrt(rms/(output.length*2)),soundEvents:sounds.length,voices:adapter.telemetry.played,unknownSounds:adapter.telemetry.unknown,limitations:['Offline digital render, not a physical audio-output test.','Web Audio mixing/envelopes are provisional; exact NW4R/DSP sound parity is unverified.']};
}
