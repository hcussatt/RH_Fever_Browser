// Original samples and RSEQ note data; Web Audio substitutes for the Wii mixer.
// Note envelopes come from the original nw4r EnvGenerator (envelope: see runtime.mjs) when given;
// LFO, filter and resampling parity remain unqualified.
// gameUrl: the game's folder (dist/<id>/), whose assets/ the build extracted.
// Music and sounds share one output gain, as on the Wii, so their balance is the original's:
// the game's master volume (CSoundManager sets AxManager::SetMasterVolume(0.7)) times a fixed
// headroom for the browser, whose output clips at full scale; .48 keeps every built level's autoplay
// render (web/engine/qa/audio-check.mjs) under it, the loudest peaking at .96.
import {assetResponse} from './assets.mjs';
import {traceSequence} from './sequence.mjs';
const OUTPUT=.7*.48;
export async function createAudio(context,gameUrl,{envelope}={}){
 const asset=name=>new URL('assets/'+name,gameUrl);
 const [data,musicInfo,resultData]=await Promise.all(['sfx.json','music.json','results.json'].map(async f=>(await assetResponse(asset(f))).json()));
 const buffers=await Promise.all(data.waves.map(async w=>context.decodeAudioData(await (await assetResponse(asset(w.file))).arrayBuffer())));
 // The sequences dynamic sounds are traced from again when they play, and the sequence player's
 // global variables (16-31, nw4r's default -1), which sounds set and read.
 const sequences=Object.fromEntries(await Promise.all([...new Set(Object.values(data.sounds).filter(s=>s.dynamic).map(s=>s.sequence.file))].map(async f=>[f,new Uint8Array(await (await assetResponse(asset(f))).arrayBuffer())])));
 const globals=new Array(16).fill(-1);
 // A sound's notes as it plays now: traced again from the globals and the game's user procedure
 // (userproc: variable -> value, from the game when it played the sound) when they depend on them.
 function soundNotes(sound,userproc){
  if(sound.dynamic)return traceSequence(sequences[sound.sequence.file],sound.sequence.start,sound.sequence.bank,data,globals,userproc);
  for(const [v,x] of Object.entries(sound.globals||{}))globals[v-16]=x;
  return sound.notes;
 }
 const master=context.createGain();master.gain.value=OUTPUT;master.connect(context.destination);
 const resultWaves=Object.fromEntries(await Promise.all(Object.entries(resultData.waves).map(async([sid,w])=>[sid,{...w,buffer:await context.decodeAudioData(await (await assetResponse(asset(w.file))).arrayBuffer())}])));
 const active=new Set(),musicGains=new WeakMap(),stops=new WeakMap(),persistent=new WeakSet(),telemetry={played:0,unknown:[],late:0,maxLateMs:0};
 function stopSource(source,when){if(when<(stops.get(source)??Infinity)){try{source.stop(when);stops.set(source,when);}catch{}}}
 const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
 const curves=new Map();
 function envelopeCurve(adsr,releaseMs,steps){
  const key=adsr.join()+'/'+Math.round(releaseMs)+'/'+steps;
  if(!curves.has(key))curves.set(key,envelope(...adsr,Math.round(releaseMs),steps));
  return curves.get(key);
 }
 // One of a note's parameters (a gain, its pan or its detune: f of the track's volume, pan or
 // bend) from its start values through the changes its track made while it plays (n.changes,
 // from the trace): a set reaches the note over one 3 ms mixer frame, as nw4r's AX volume ramp
 // does, and a timed move (0xa3) steps once a sequence tick (MoveValue), in between linearly.
 function follow(param,start,changes,names,f,t,n,stretch){
  param.value=f(start);
  const cs=(changes||[]).filter(c=>names.includes(c[1]));
  if(!cs.length)return;
  const value=(s,m,name,x)=>{const v=m[name];return !v||x>=v[2]+v[3]?s[name]:v[0]+(v[1]-v[0])*(x-v[2])/v[3];};
  // The track's values at x: after the changes made then, or with before, just before them.
  const at=(x,before)=>{
   const s={...start},m={};
   for(const [time,name,to,sec] of cs){
    if(before?time>=x:time>x)break;
    if(sec)m[name]=[value(s,m,name,time),to,time,sec];else delete m[name];
    s[name]=to;
   }
   for(const name of names)s[name]=value(s,m,name,x);
   return s;
  };
  const tick=60/(n.tempo*n.timebase),points=[];
  for(const [time,,,sec] of cs){
   points.push([time,0]);
   if(!sec)points.push([time+.003,1]);
   else{const steps=Math.max(1,Math.round(sec/tick));for(let k=1;k<=steps;k++)points.push([time+sec*k/steps,1]);}
  }
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let last=t;
  for(const [time,ramp] of points){
   const when=Math.max(t+time*stretch,last+1e-6);last=when;
   if(ramp)param.linearRampToValueAtTime(f(at(time,false)),when);else param.setValueAtTime(f(at(time,true)),when);
  }
 }
 // tune: the volume, pitch and pan the game set on this sound (nw4r SoundHandle ratios), the
 // chart tempo when it plays, and a start offset in ticks (CSoundManager::play's start above 0).
 // Returns the voice: the sound's notes behind one handle volume and one pause gain, which
 // tune() changes later, as the game does through its SNDHandle.
 function play(sid,when=context.currentTime,{volume:tuneVolume=1,pitch:tunePitch=1,pan:tunePan=0,tempo,offset=0,userproc}={}){
  const sound=data.sounds[sid];if(!sound){telemetry.unknown.push(sid);return null;}
  const notes=soundNotes(sound,userproc);
  const handleGain=context.createGain(),pauseGain=context.createGain();handleGain.gain.value=tuneVolume;handleGain.connect(pauseGain).connect(master);
  const voice={sid,when,handleGain,pauseGain,notes:[],volume:tuneVolume,paused:0};
  // A sequence in the game's tempo table plays at the chart tempo over the tempo it was written
  // at (CSoundManager::tune_tempo_rel): its ticks, not its pitch, are stretched.
  const stretch=sound.tempo&&tempo?sound.tempo/tempo:1;
  const late=Math.max(0,context.currentTime-when);if(late>.003){telemetry.late++;telemetry.maxLateMs=Math.max(telemetry.maxLateMs,late*1000);}
  // Ticks into the sound, in the sequence's own ticks at its tempo.
  const skip=offset&&notes.length?offset*60/(notes[0].tempo*notes[0].timebase)*stretch:0;
  const drawn={};
  for(const n of notes){
   if(n.time*stretch<skip)continue;
   const p=data.programs[n.program],w=data.waves[p.wave],source=context.createBufferSource(),env=context.createGain(),gain=context.createGain(),gain2=context.createGain(),pan=context.createStereoPanner();
   source.buffer=buffers[p.wave];source.loop=w.loop;source.loopStart=w.loopStart/w.rate;source.loopEnd=w.samples/w.rate;
   // A random parameter (0xa0) is drawn once per sound for each command range.
   const draw=name=>{const r=n.random[name];if(!r)return n[name];const key=name+r;if(!(key in drawn))drawn[key]=r[0]+Math.floor(Math.random()*(r[1]-r[0]+1));return drawn[key];};
   const start={volume:draw('volume'),volume2:n.volume2,pan:draw('pan'),bend:draw('bend'),bendRange:n.bendRange},transpose=draw('transpose');
   // Pitch bend goes on detune (cents), so a slide is linear in semitones as in nw4r and the
   // game's own pitch (tune) stays on playbackRate.
   const rate=2**((n.note+transpose-p.key)/12)*p.pitch,cents=s=>s.bend/128*s.bendRange*100;
   // A sound asked for in the past (a late hit) plays its overdue notes now and the rest on time,
   // like nw4r's tick start offset.
   const t=Math.max(context.currentTime,when+n.time*stretch-skip),duration=n.length?n.duration*stretch:n.duration;source.playbackRate.value=rate*tunePitch;
   // As in the original code: the sound record's volume (SoundArchivePlayer) and the
   // instrument's volume (Bank::NoteOn) are linear; velocity and track volumes are squared.
   const level=sound.volume/127*(n.velocity/127)**2*p.volume/127;
   const basePan=(p.pan-64)/63,panOf=s=>clamp((s.pan-64)/63+basePan+tunePan,-1,1);
   follow(gain.gain,start,n.changes,['volume'],s=>level*(s.volume/127)**2,t,n,stretch);
   follow(gain2.gain,start,n.changes,['volume2'],s=>(s.volume2/127)**2,t,n,stretch);
   follow(pan.pan,start,n.changes,['pan'],panOf,t,n,stretch);
   follow(source.detune,start,n.changes,['bend','bendRange'],cents,t,n,stretch);
   // nw4r Channel's sweep (sequence.mjs): from n.sweep semitones off back to the note's pitch,
   // linearly in semitones, over its porta time (in 3 ms mixer steps) or its ticks.
   if(n.sweep){const end=t+(n.sweepMs!=null?n.sweepMs/1000:duration);source.playbackRate.setValueAtTime(rate*tunePitch*2**(n.sweep/12),t);if(end>t)source.playbackRate.exponentialRampToValueAtTime(rate*tunePitch,end);}
   source.connect(env).connect(gain).connect(gain2).connect(pan).connect(handleGain);source.start(t);
   voice.notes.push({source,pan,basePan:(start.pan-64)/63+basePan,rate,start:t});
   const sampleDuration=source.buffer.duration/(rate*tunePitch*2**(cents(start)/1200));
   if(envelope){
    // A note with a length is released when it ends; a one-shot plays its sample out.
    const releaseMs=n.length||source.loop?duration*1000:-1;
    const steps=releaseMs<0?Math.ceil(sampleDuration/.003)+1:4096;
    const curve=envelopeCurve([n.attack??p.attack,n.hold??p.hold,n.decay??p.decay,n.sustain??p.sustain,n.release??p.release],releaseMs,steps);
    if(curve.length>1)env.gain.setValueCurveAtTime(curve,t,(curve.length-1)*.003);else env.gain.value=curve[0]??1;
    if(releaseMs>=0)stopSource(source,t+(curve.length-1)*.003);
   }
   else if(n.length||source.loop){
    const release=n.release??p.release;
    // Provisional adapter envelope; retained as an explicit parity limitation.
    const tail=release===127?.003:clamp((127-release)*.006,.004,.35),end=t+duration;
    env.gain.setTargetAtTime(0,end,tail/5);stopSource(source,end+tail);
   }
   source.onended=()=>{active.delete(source);source.disconnect();env.disconnect();gain.disconnect();gain2.disconnect();pan.disconnect();if(!--voice.live){handleGain.disconnect();pauseGain.disconnect();}};voice.live=(voice.live||0)+1;active.add(source);if(sound.persistent)persistent.add(source);telemetry.played++;
  }
  voice.start=voice.notes.length?Math.min(...voice.notes.map(n=>n.start)):when;
  if(!voice.notes.length){handleGain.disconnect();pauseGain.disconnect();}
  return voice;
 }
 // An AudioParam's automation from time t on replaced by a move to value over seconds.
 function move(param,from,value,t,seconds){
  param.cancelScheduledValues(t);param.setValueAtTime(from,t);
  if(seconds>0)param.linearRampToValueAtTime(value,t+seconds);else param.setValueAtTime(value,t);
 }
 // Tuning on a playing (or scheduled) sound at time `when`, like nw4r's SoundHandle: volume and
 // pause fade over frames (60 per second), pitch and pan replace the ones set at the start, and
 // a stop fades out over frames. Pause is a fade to silence: the sound keeps its place unheard.
 function tune(voice,{type,value,frames},when){
  if(!voice)return;
  const t=Math.max(context.currentTime,when,voice.start),seconds=frames/60;
  if(type===0){move(voice.handleGain.gain,voice.volume,value,t,seconds);voice.volume=value;}
  else if(type===1)for(const n of voice.notes)n.source.playbackRate.setValueAtTime(n.rate*value,t);
  else if(type===2)for(const n of voice.notes)n.pan.pan.setValueAtTime(clamp(n.basePan+value,-1,1),t);
  else if(type===4){move(voice.handleGain.gain,voice.volume,0,t,seconds);voice.volume=0;for(const n of voice.notes)stopSource(n.source,t+seconds)}
  else if(type===5){const to=value?0:1;move(voice.pauseGain.gain,voice.paused?0:1,to,t,seconds);voice.paused=value;}
 }
 // Drops a voice that has not started yet (a speed change moved its time); false if it has.
 function cancel(voice){
  if(!voice||voice.start<=context.currentTime+.002)return false;
  for(const n of voice.notes)stopSource(n.source,context.currentTime)
  return true;
 }
 // The backing track: an original wave sound, at its record volume (linear, like every sound record).
 function playMusic(buffer,when,info=musicInfo){
  const source=context.createBufferSource(),gain=context.createGain(),handle=context.createGain();
  source.buffer=buffer;gain.gain.value=(info.volume??127)/127;source.loop=!!info.loop;source.loopStart=(info.loopStart||0)/(info.rate||buffer.sampleRate);source.loopEnd=buffer.duration;
  source.connect(gain).connect(handle).connect(master);source.start(when);
  active.add(source);source.onended=()=>{active.delete(source);source.disconnect();gain.disconnect();handle.disconnect();};musicGains.set(source,gain);
  let volume=1;
  return {source,
   volume(value,frames,at){const t=Math.max(context.currentTime,at);move(handle.gain,volume,value,t,frames/60);volume=value;},
   speed(value,at){source.playbackRate.setValueAtTime(value,Math.max(context.currentTime,at));}};
 }
 function playWave(sid,when){const w=resultWaves[sid];if(!w)throw new Error('Missing original result wave '+sid);return playMusic(w.buffer,when,w).source;}
 function stopWave(source,when,frames){if(!source)return;const gain=musicGains.get(source),t=Math.max(context.currentTime,when);if(gain&&frames){gain.gain.setValueAtTime(gain.gain.value,t);gain.gain.linearRampToValueAtTime(0,t+frames/60);}stopSource(source,t+frames/60);}
 function stopAt(when){const t=Math.max(context.currentTime,when);for(const s of active)if(!persistent.has(s))stopSource(s,t);}
 return {play,tune,cancel,playMusic,playWave,stopWave,stopAt,master,data,buffers,telemetry,stop(){for(const s of active)stopSource(s,context.currentTime);active.clear();}};
}
