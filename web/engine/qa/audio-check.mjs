// Offline render of a full autoplay run (dist/<id>/qa/autoplay-sounds.json, written
// by tests/test-runtime.mjs --auto). From a game page: (await import('../engine/qa/audio-check.mjs')).checkAudio(location.href)
import {createAudio} from '../audio.mjs';
export async function checkAudio(gameUrl,{envelope=globalThis.rhf?.g?.envelope}={}){
 const sampleRate=48000,context=new OfflineAudioContext(2,Math.ceil(110*sampleRate),sampleRate);
 const [adapter,music,sounds]=await Promise.all([createAudio(context,gameUrl,{envelope}),fetch(new URL('assets/music.wav',gameUrl)).then(r=>r.arrayBuffer()).then(b=>context.decodeAudioData(b)),fetch(new URL('qa/autoplay-sounds.json',gameUrl)).then(r=>r.json())]);
 adapter.playMusic(music,0);
 for(const e of sounds)adapter.play(e.sid,e.time,e);
 const output=await context.startRendering();let peak=0,clips=0,nonfinite=0,rms=0;
 for(let ch=0;ch<2;ch++){const pcm=output.getChannelData(ch);for(const x of pcm){peak=Math.max(peak,Math.abs(x));if(Math.abs(x)>=1)clips++;if(!Number.isFinite(x))nonfinite++;rms+=x*x;}}
 return {envelopes:!!envelope,sampleRate,seconds:output.duration,channels:2,peak,clippedSamples:clips,nonfiniteSamples:nonfinite,rms:Math.sqrt(rms/(output.length*2)),soundEvents:sounds.length,voices:adapter.telemetry.played,unknownSounds:adapter.telemetry.unknown,limitations:['Offline render checks digital output; it cannot measure physical device underruns or speaker output.',envelope?'Note envelopes come from the original nw4r EnvGenerator; pan, LFO and filters are still approximated.':'Without the game core, note envelopes fall back to a provisional approximation.']};
}
