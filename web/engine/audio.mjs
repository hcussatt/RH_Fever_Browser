// Original samples and RSEQ note data; Web Audio substitutes for the Wii mixer.
// Envelope, LFO, filter and resampling parity remain unqualified. See RECOMPILATION.md.
// gameUrl: the game's folder (dist/<id>/), whose assets/ the build extracted.
export async function createAudio(context,gameUrl){
 const asset=name=>new URL('assets/'+name,gameUrl);
 const data=await (await fetch(asset('sfx.json'))).json();
 const buffers=await Promise.all(data.waves.map(async w=>context.decodeAudioData(await (await fetch(asset(w.file))).arrayBuffer())));
 const master=context.createGain();master.gain.value=.24;master.connect(context.destination);
 const active=new Set(),telemetry={played:0,unknown:[],late:0,maxLateMs:0};
 const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
 function play(sid,when=context.currentTime){
  const sound=data.sounds[sid];if(!sound){telemetry.unknown.push(sid);return;}
  const late=Math.max(0,context.currentTime-when);if(late>.003){telemetry.late++;telemetry.maxLateMs=Math.max(telemetry.maxLateMs,late*1000);}
  when=Math.max(context.currentTime,when);
  for(const n of sound.notes){
   const p=data.programs[n.program],w=data.waves[p.wave],source=context.createBufferSource(),gain=context.createGain(),pan=context.createStereoPanner();
   source.buffer=buffers[p.wave];source.loop=w.loop;source.loopStart=w.loopStart/w.rate;source.loopEnd=w.samples/w.rate;
   let bend=n.bend;if(n.random.bend)bend=n.random.bend[0]+Math.floor(Math.random()*(n.random.bend[1]-n.random.bend[0]+1));
   const pitch=((n.note+n.transpose-p.key)+bend/128*n.bendRange),rate=2**(pitch/12)*p.pitch;
   const t=when+n.time;source.playbackRate.value=rate;
   // MIDI-like NW4R volume bytes use a squared amplitude curve.
   const level=(sound.volume/127)**2*(n.velocity/127)**2*(p.volume/127)**2*(n.volume2/127)**2;
   const ramp=n.random.volumeRamp;
   let vol=n.volume;
   if(ramp)vol=ramp.from+(ramp.to-ramp.from)*clamp((n.time-ramp.time)/ramp.seconds,0,1);
   gain.gain.setValueAtTime(level*(vol/127)**2,t);
   if(ramp&&ramp.time+ramp.seconds>n.time)gain.gain.linearRampToValueAtTime(level*(ramp.to/127)**2,when+ramp.time+ramp.seconds);
   const panValue=clamp(((n.pan-64)+(p.pan-64))/63,-1,1);pan.pan.value=panValue;
   const panRamp=n.random.panRamp;if(panRamp){pan.pan.setValueAtTime(clamp((panRamp.from-64)/63,-1,1),t);pan.pan.linearRampToValueAtTime(clamp((panRamp.to-64)/63,-1,1),Math.max(t+.001,when+panRamp.time+panRamp.seconds));}
   if(n.sweepPitch){const sweep=n.sweepPitch>32767?n.sweepPitch-65536:n.sweepPitch;source.playbackRate.setValueAtTime(rate*2**(sweep/(64*12)),t);source.playbackRate.exponentialRampToValueAtTime(rate,t+Math.max(.003,n.duration));}
   source.connect(gain).connect(pan).connect(master);source.start(t);
   const sampleDuration=source.buffer.duration/rate;
   if(n.length||source.loop){
    const release=n.release??p.release;
    // Provisional adapter envelope; retained as an explicit parity limitation.
    const tail=release===127?.003:clamp((127-release)*.006,.004,.35),end=t+n.duration;
    gain.gain.setTargetAtTime(0,end,tail/5);source.stop(end+tail);
   }
   source.onended=()=>{active.delete(source);source.disconnect();gain.disconnect();pan.disconnect();};active.add(source);telemetry.played++;
  }
 }
 return {play,master,data,buffers,telemetry,stop(){for(const s of active){try{s.stop();}catch{}}active.clear();}};
}
