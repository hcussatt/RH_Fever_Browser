// Plays the game's mix (16-bit stereo at the 3DS DSP rate, 32728 Hz) at the context's rate (a plain copy when
// the page opened the context at 32728 Hz, else linear interpolation), and tells the game's worker how many
// game samples are still queued, and how many audio blocks ran out of samples (gaps: heard as a stutter).
class GameAudio extends AudioWorkletProcessor{
  constructor(){super();this.chunks=[];this.at=0;this.queued=0;this.step=32728/sampleRate;this.done=0;
    this.port.onmessage=({data})=>{if(data instanceof MessagePort){this.game=data;this.game.onmessage=({data})=>{this.chunks.push(data);this.queued+=data.length/2;};}};}
  process(_,[out]){
    const L=out[0],R=out[1]||out[0];let gap=false;
    // Every block: the game samples still queued, and which game sample (done + at) plays at the block's
    // context time, so the worker can tell which sample the player hears at any moment.
    if(this.game)this.game.postMessage({queued:this.queued-this.at,pos:this.done+this.at,t:currentTime,gaps:this.gaps||0});
    for(let i=0;i<L.length;i++){
      const c=this.chunks[0];if(!c){L[i]=R[i]=0;if(this.done)gap=true;continue;}
      const k=Math.floor(this.at),f=this.at-k,n=c.length/2;
      const next=k+1<n?c:this.chunks[1],kn=k+1<n?k+1:0;
      const l1=next?next[2*kn]:c[2*k],r1=next?next[2*kn+1]:c[2*k+1];
      L[i]=(c[2*k]+(l1-c[2*k])*f)/32768;R[i]=(c[2*k+1]+(r1-c[2*k+1])*f)/32768;
      this.at+=this.step;while(this.chunks[0]&&this.at>=this.chunks[0].length/2){this.at-=this.chunks[0].length/2;this.done+=this.chunks[0].length/2;this.queued-=this.chunks[0].length/2;this.chunks.shift();}}
    if(gap)this.gaps=(this.gaps||0)+1;
    return true;}}
registerProcessor('game-audio',GameAudio);
