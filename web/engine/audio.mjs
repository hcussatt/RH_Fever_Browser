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
 // tune: the volume, pitch and pan the game set on this sound (nw4r SoundHandle ratios), and
 // the chart tempo when it plays.
 function play(sid,when=context.currentTime,{volume:tuneVolume=1,pitch:tunePitch=1,pan:tunePan=0,tempo}={}){
  const sound=data.sounds[sid];if(!sound){telemetry.unknown.push(sid);return;}
  // A sequence in the game's tempo table plays at the chart tempo over the tempo it was written
  // at (CSoundManager::tune_tempo_rel): its ticks, not its pitch, are stretched.
  const stretch=sound.tempo&&tempo?sound.tempo/tempo:1;
  const late=Math.max(0,context.currentTime-when);if(late>.003){telemetry.late++;telemetry.maxLateMs=Math.max(telemetry.maxLateMs,late*1000);}
  for(const n of sound.notes){
   const p=data.programs[n.program],w=data.waves[p.wave],source=context.createBufferSource(),env=context.createGain(),gain=context.createGain(),pan=context.createStereoPanner();
   source.buffer=buffers[p.wave];source.loop=w.loop;source.loopStart=w.loopStart/w.rate;source.loopEnd=w.samples/w.rate;
   let bend=n.bend;if(n.random.bend)bend=n.random.bend[0]+Math.floor(Math.random()*(n.random.bend[1]-n.random.bend[0]+1));
   const pitch=((n.note+n.transpose-p.key)+bend/128*n.bendRange),rate=2**(pitch/12)*p.pitch;
   // A sound asked for in the past (a late hit) plays its overdue notes now and the rest on time,
   // like nw4r's tick start offset.
   const t=Math.max(context.currentTime,when+n.time*stretch),duration=n.length?n.duration*stretch:n.duration;source.playbackRate.value=rate*tunePitch;
   // As in the original code: the sound record's volume (SoundArchivePlayer) and the
   // instrument's volume (Bank::NoteOn) are linear; velocity and track volumes are squared.
   const level=sound.volume/127*(n.velocity/127)**2*p.volume/127*(n.volume2/127)**2;
   const ramp=n.random.volumeRamp;
   let vol=n.volume;
   if(ramp)vol=ramp.from+(ramp.to-ramp.from)*clamp((n.time-ramp.time)/ramp.seconds,0,1);
   const rampEnd=ramp&&Math.max(t+.001,when+(ramp.time+ramp.seconds)*stretch);
   gain.gain.setValueAtTime(tuneVolume*level*(vol/127)**2,t);
   if(ramp&&ramp.time+ramp.seconds>n.time)gain.gain.linearRampToValueAtTime(tuneVolume*level*(ramp.to/127)**2,rampEnd);
   const panValue=clamp(((n.pan-64)+(p.pan-64))/63+tunePan,-1,1);pan.pan.value=panValue;
   const panRamp=n.random.panRamp;if(panRamp){pan.pan.setValueAtTime(clamp((panRamp.from-64)/63,-1,1),t);pan.pan.linearRampToValueAtTime(clamp((panRamp.to-64)/63,-1,1),Math.max(t+.001,when+(panRamp.time+panRamp.seconds)*stretch));}
   if(n.sweepPitch){const sweep=n.sweepPitch>32767?n.sweepPitch-65536:n.sweepPitch;source.playbackRate.setValueAtTime(rate*tunePitch*2**(sweep/(64*12)),t);source.playbackRate.exponentialRampToValueAtTime(rate*tunePitch,t+Math.max(.003,duration));}
   source.connect(env).connect(gain).connect(pan).connect(master);source.start(t);
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
   source.onended=()=>{active.delete(source);source.disconnect();env.disconnect();gain.disconnect();pan.disconnect();};active.add(source);telemetry.played++;
  }
 }
 // The backing track: an original wave sound, at its record volume (linear, like every sound record).
 function playMusic(buffer,when){
  const source=context.createBufferSource(),gain=context.createGain();
  source.buffer=buffer;gain.gain.value=(musicInfo.volume??127)/127;source.connect(gain).connect(master);source.start(when);
  return source;
 }
 return {play,playMusic,master,data,buffers,telemetry,stop(){for(const s of active){try{s.stop();}catch{}}active.clear();}};
}
