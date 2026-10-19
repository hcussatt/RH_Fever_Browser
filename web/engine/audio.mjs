// Original samples and RSEQ note data; Web Audio substitutes for the Wii mixer.
// Note envelopes come from the original nw4r EnvGenerator (envelope: see runtime.mjs) when given;
// LFO, filter and resampling parity remain unqualified.
// gameUrl: the game's folder (dist/<id>/), whose assets/ the build extracted.
// Music and sounds share one output gain, as on the Wii, so their balance is the original's:
// the game's master volume (CSoundManager sets AxManager::SetMasterVolume(0.7)) times a fixed
// headroom for the browser, whose output clips at full scale; .55 keeps every built level under it.
const OUTPUT=.7*.55;
export async function createAudio(context,gameUrl,{envelope}={}){
 const asset=name=>new URL('assets/'+name,gameUrl);
 const [data,musicInfo]=await Promise.all(['sfx.json','music.json'].map(async f=>(await fetch(asset(f))).json()));
 const buffers=await Promise.all(data.waves.map(async w=>context.decodeAudioData(await (await fetch(asset(w.file))).arrayBuffer())));
 const master=context.createGain();master.gain.value=OUTPUT;master.connect(context.destination);
 const active=new Set(),telemetry={played:0,unknown:[],late:0,maxLateMs:0};
 const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
 const curves=new Map();
 function envelopeCurve(adsr,releaseMs,steps){
  const key=adsr.join()+'/'+Math.round(releaseMs)+'/'+steps;
  if(!curves.has(key))curves.set(key,envelope(...adsr,Math.round(releaseMs),steps));
  return curves.get(key);
 }
 // tune: the volume, pitch and pan the game set on this sound (nw4r SoundHandle ratios), the
 // chart tempo when it plays, and a start offset in ticks (CSoundManager::play's start above 0).
 // Returns the voice: the sound's notes behind one handle volume and one pause gain, which
 // tune() changes later, as the game does through its SNDHandle.
 function play(sid,when=context.currentTime,{volume:tuneVolume=1,pitch:tunePitch=1,pan:tunePan=0,tempo,offset=0}={}){
  const sound=data.sounds[sid];if(!sound){telemetry.unknown.push(sid);return null;}
  const handleGain=context.createGain(),pauseGain=context.createGain();handleGain.gain.value=tuneVolume;handleGain.connect(pauseGain).connect(master);
  const voice={sid,when,handleGain,pauseGain,notes:[],volume:tuneVolume,paused:0};
  // A sequence in the game's tempo table plays at the chart tempo over the tempo it was written
  // at (CSoundManager::tune_tempo_rel): its ticks, not its pitch, are stretched.
  const stretch=sound.tempo&&tempo?sound.tempo/tempo:1;
  const late=Math.max(0,context.currentTime-when);if(late>.003){telemetry.late++;telemetry.maxLateMs=Math.max(telemetry.maxLateMs,late*1000);}
  // Ticks into the sound, in the sequence's own ticks at its tempo.
  const skip=offset&&sound.notes.length?offset*60/(sound.notes[0].tempo*sound.notes[0].timebase)*stretch:0;
  for(const n of sound.notes){
   if(n.time*stretch<skip)continue;
   const p=data.programs[n.program],w=data.waves[p.wave],source=context.createBufferSource(),env=context.createGain(),gain=context.createGain(),pan=context.createStereoPanner();
   source.buffer=buffers[p.wave];source.loop=w.loop;source.loopStart=w.loopStart/w.rate;source.loopEnd=w.samples/w.rate;
   let bend=n.bend;if(n.random.bend)bend=n.random.bend[0]+Math.floor(Math.random()*(n.random.bend[1]-n.random.bend[0]+1));
   const pitch=((n.note+n.transpose-p.key)+bend/128*n.bendRange),rate=2**(pitch/12)*p.pitch;
   // A sound asked for in the past (a late hit) plays its overdue notes now and the rest on time,
   // like nw4r's tick start offset.
   const t=Math.max(context.currentTime,when+n.time*stretch-skip),duration=n.length?n.duration*stretch:n.duration;source.playbackRate.value=rate*tunePitch;
   // As in the original code: the sound record's volume (SoundArchivePlayer) and the
   // instrument's volume (Bank::NoteOn) are linear; velocity and track volumes are squared.
   const level=sound.volume/127*(n.velocity/127)**2*p.volume/127*(n.volume2/127)**2;
   const ramp=n.random.volumeRamp;
   let vol=n.volume;
   if(ramp)vol=ramp.from+(ramp.to-ramp.from)*clamp((n.time-ramp.time)/ramp.seconds,0,1);
   const rampEnd=ramp&&Math.max(t+.001,when+(ramp.time+ramp.seconds)*stretch-skip);
   gain.gain.setValueAtTime(level*(vol/127)**2,t);
   if(ramp&&ramp.time+ramp.seconds>n.time)gain.gain.linearRampToValueAtTime(level*(ramp.to/127)**2,rampEnd);
   const basePan=((n.pan-64)+(p.pan-64))/63;pan.pan.value=clamp(basePan+tunePan,-1,1);
   const panRamp=n.random.panRamp;if(panRamp){pan.pan.setValueAtTime(clamp((panRamp.from-64)/63,-1,1),t);pan.pan.linearRampToValueAtTime(clamp((panRamp.to-64)/63,-1,1),Math.max(t+.001,when+(panRamp.time+panRamp.seconds)*stretch-skip));}
   if(n.sweepPitch){const sweep=n.sweepPitch>32767?n.sweepPitch-65536:n.sweepPitch;source.playbackRate.setValueAtTime(rate*tunePitch*2**(sweep/(64*12)),t);source.playbackRate.exponentialRampToValueAtTime(rate*tunePitch,t+Math.max(.003,duration));}
   source.connect(env).connect(gain).connect(pan).connect(handleGain);source.start(t);
   voice.notes.push({source,pan,basePan,rate,start:t});
   const sampleDuration=source.buffer.duration/(rate*tunePitch);
   if(envelope){
    // A note with a length is released when it ends; a one-shot plays its sample out.
    const releaseMs=n.length||source.loop?duration*1000:-1;
    const steps=releaseMs<0?Math.ceil(sampleDuration/.003)+1:4096;
    const curve=envelopeCurve([n.attack??p.attack,n.hold??p.hold,n.decay??p.decay,n.sustain??p.sustain,n.release??p.release],releaseMs,steps);
    if(curve.length>1)env.gain.setValueCurveAtTime(curve,t,(curve.length-1)*.003);else env.gain.value=curve[0]??1;
    if(releaseMs>=0)source.stop(t+(curve.length-1)*.003);
   }
   else if(n.length||source.loop){
    const release=n.release??p.release;
    // Provisional adapter envelope; retained as an explicit parity limitation.
    const tail=release===127?.003:clamp((127-release)*.006,.004,.35),end=t+duration;
    gain.gain.setTargetAtTime(0,end,tail/5);source.stop(end+tail);
   }
   source.onended=()=>{active.delete(source);source.disconnect();env.disconnect();gain.disconnect();pan.disconnect();if(!--voice.live){handleGain.disconnect();pauseGain.disconnect();}};voice.live=(voice.live||0)+1;active.add(source);telemetry.played++;
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
  else if(type===4){move(voice.handleGain.gain,voice.volume,0,t,seconds);voice.volume=0;for(const n of voice.notes){try{n.source.stop(t+seconds);}catch{}}}
  else if(type===5){const to=value?0:1;move(voice.pauseGain.gain,voice.paused?0:1,to,t,seconds);voice.paused=value;}
 }
 // Drops a voice that has not started yet (a speed change moved its time); false if it has.
 function cancel(voice){
  if(!voice||voice.start<=context.currentTime+.002)return false;
  for(const n of voice.notes){try{n.source.stop();}catch{}}
  return true;
 }
 // The backing track: an original wave sound, at its record volume (linear, like every sound record).
 function playMusic(buffer,when){
  const source=context.createBufferSource(),gain=context.createGain(),handle=context.createGain();
  source.buffer=buffer;gain.gain.value=(musicInfo.volume??127)/127;source.connect(gain).connect(handle).connect(master);source.start(when);
  let volume=1;
  return {source,
   // The chart's backing track volume (CTickFlowManager's wave handle), faded over frames.
   volume(value,frames,at){const t=Math.max(context.currentTime,at);move(handle.gain,volume,value,t,frames/60);volume=value;},
   // Song speed: the track's playback rate and pitch (nw4r SetPitch on the wave).
   speed(value,at){source.playbackRate.setValueAtTime(value,Math.max(context.currentTime,at));}};
 }
 return {play,tune,cancel,playMusic,master,data,buffers,telemetry,stop(){for(const s of active){try{s.stop();}catch{}}active.clear();}};
}
