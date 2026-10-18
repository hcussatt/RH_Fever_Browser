// Converts between chart ticks (48 per beat) and seconds of the backing track.
// Every game runs on this one clock; a later versus mode only needs to agree on
// when second 0 of the track starts.
export function createClock(tempo){
 const segments=tempo.tempoSegments;
 if(!segments){
  // Fixed tempo: one rate for the whole chart.
  const spt=tempo.secondsPerTick;
  return {secondsAtTick:tick=>tick*spt,tickAtSeconds:time=>time/spt,tempoAtTick:()=>60/(48*spt)};
 }
 function secondsAtTick(tick){let time=0;for(const s of segments){const ticks=s.beats*48;if(tick<=ticks)return time+tick/ticks*s.samples/s.rate;time+=s.samples/s.rate;tick-=ticks;}const s=segments.at(-1);return time+tick/(s.beats*48)*s.samples/s.rate;}
 function tickAtSeconds(time){let ticks=0;for(const s of segments){const seconds=s.samples/s.rate;if(time<=seconds)return ticks+time/seconds*s.beats*48;ticks+=s.beats*48;time-=seconds;}const s=segments.at(-1);return ticks+time/(s.samples/s.rate)*s.beats*48;}
 // Beats per minute of the segment holding this tick (the first one before tick 0).
 function tempoAtTick(tick){for(const s of segments){if(tick<s.beats*48)return s.beats*60*s.rate/s.samples;tick-=s.beats*48;}const s=segments.at(-1);return s.beats*60*s.rate/s.samples;}
 return {secondsAtTick,tickAtSeconds,tempoAtTick};
}
