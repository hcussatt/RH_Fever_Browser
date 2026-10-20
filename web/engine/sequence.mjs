// A sound's RSEQ program traced into notes, as tools/extract-sfx.py traces it at build time; the
// browser traces a dynamic sound again when it plays (see extract-sfx.py), from the sequence
// player's global variables then. globals: variables 16-31 (index 0-15), kept between sounds and
// changed by what the trace sets. userproc: the variables the game's user procedure set (index ->
// value), applied where the sequence calls it (F0 E0).
// tests/test-sequence.mjs checks that this gives every sound's notes extract-sfx.py gives it.
const s16=x=>((x+0x8000&0xffff)-0x8000);
// The track values a playing note follows, and the longest a released note can still sound
// (platform.c envelope_curve's 4096 mixer frames of 3 ms): see extract-sfx.py's trace.
const LIVE=['volume','volume2','pan','bend','bendRange'],RELEASE=4096*.003;
const NAMES={0xb0:'timebase',0xc0:'pan',0xc1:'volume',0xc2:'playerVolume',0xc3:'transpose',0xc4:'bend',0xc5:'bendRange',0xc7:'noteWait',0xd0:'attack',0xd1:'decay',0xd2:'sustain',0xd3:'release',0xd5:'volume2',0xd8:'lpf',0xd9:'fxA',0xda:'fxB',0xdb:'mainSend',0xdd:'mute',0xdf:'damper',0xdc:'initPan',0xc8:'tie',0xc9:'portamento',0xce:'portaSpeed',0xcf:'portaTime',0xca:'lfoDepth',0xcb:'lfoSpeed',0xcc:'lfoTarget',0xcd:'lfoRange',0xb1:'hold',0xb2:'monophonic',0xb3:'velocityRange',0xb4:'biquadType',0xb5:'biquadValue'};
// seq: the sequence's data block (sequence-<file>.bin); start: the sound's offset in it; bank: the index of its bank's
// first program in programs.
export function traceSequence(seq,start,bank,{programs,waves},globals,userproc={},random=Math.random){
 const notes=[],queue=[[start,0]],local=new Map(),player={tempo:120,timebase:48};
 const read=v=>v>=16&&v<32?globals[v-16]:local.has(v)?local.get(v):-1;
 const write=(v,x)=>{x=s16(x);if(v>=16&&v<32)globals[v-16]=x;else local.set(v,x);};
 while(queue.length){
  let [pc,t]=queue.shift();
  const state={program:0,volume:127,volume2:127,pan:64,transpose:0,bend:0,bendRange:2,noteWait:1,...player},stack=[],loops=[],pending={};
  let steps=0,live=[];
  const moves=new Map();
  const current=(name,at)=>{
   if(!moves.has(name))return state[name];
   const [f,to,begin,sec]=moves.get(name);
   if(at>=begin+sec)return to;
   return f+(to-f)*(at-begin)/sec;
  };
  const byte=()=>seq[pc++];
  const vlq=()=>{let v=0;for(;;){const x=byte();v=v*128+(x&127);if(x<128)return v;}};
  const addr=()=>byte()*65536+byte()*256+byte();
  for(;;){
   if(++steps>10000)throw new Error('runaway sequence');
   const at=pc;let op=byte(),random_=null,arg2=false,argkind=null,execute=true;
   if(op===0xa2){op=byte();execute=state.condition??true;}
   if(op===0xa0||op===0xa1){argkind=op;op=byte();}
   if(op===0xa3){op=byte();arg2=true;}
   const arg=(kind='byte')=>{
    if(argkind===0xa0){
     const lo=(seq[pc]<<8|seq[pc+1])<<16>>16,hi=(seq[pc+2]<<8|seq[pc+3])<<16>>16;pc+=4;
     random_=[lo,hi];return Math.floor((lo+hi)/2);
    }
    if(argkind===0xa1)return read(byte());
    return kind==='vlq'?vlq():kind==='short'?(byte()<<8)|byte():byte();
   };
   // A conditional command (0xa2) whose condition is false is read past and not run.
   if(!execute){
    if(op<0x80){byte();arg('vlq');}
    else if(op===0x80||op===0x81)arg('vlq');
    else if(op===0x88){byte();addr();}
    else if(op===0x89||op===0x8a)addr();
    else if(op>=0xb0&&op<=0xdf){arg();if(arg2)arg('short');}
    else if(op>=0xe0&&op<=0xe3||op===0xfe)arg('short');
    else if(op===0xf0){if(byte()!==0xe0)byte();arg('short');}
    else if(![0xfb,0xfc,0xfd,0xff].includes(op))throw new Error(`unhandled conditional ${op.toString(16)} at ${at.toString(16)}`);
    continue;
   }
   if(op<0x80){
    const velocity=byte(),length=arg('vlq'),p=programs[bank+state.program],now=Object.fromEntries(LIVE.map(name=>[name,current(name,t)]));
    const rate=2**((op+state.transpose-p.key+now.bend/128*now.bendRange)/12)*p.pitch;
    const duration=length?length*60/state.tempo/state.timebase:waves[p.wave].samples/waves[p.wave].rate/rate;
    const note={...state,...now,program:bank+state.program,time:t,note:op,velocity,length,duration,random:{...pending}};
    for(const name of LIVE){const m=moves.get(name);if(m&&t<m[2]+m[3])(note.changes??=[]).push([0,name,m[1],m[2]+m[3]-t]);}
    notes.push(note);live.push(note);
    if(state.noteWait)t+=duration;
   }
   else if(op===0xf0){
    const sub=byte();
    if(sub===0xe0){
     const proc=arg('short');
     if(proc!==0)throw new Error('Sequence user procedure '+proc+' is not modelled');
     for(const [v,x] of Object.entries(userproc))write(+v,x);
     continue;
    }
    const v=byte(),x=arg('short');
    if(sub===0x80)write(v,x);
    // nw4r Util::CalcRandom scaled to 0..|x| and given x's sign.
    else if(sub===0x86){const r=Math.floor(random()*65536)*(Math.abs(x)+1)>>16;write(v,x<0?-r:r);}
    else if(sub===0x8a)write(v,~x);
    else if([0x81,0x82,0x83,0x84,0x85,0x87,0x88,0x89,0x8b].includes(sub)){
     const old=read(v);
     if(sub===0x81)write(v,old+x);
     else if(sub===0x82)write(v,old-x);
     else if(sub===0x83)write(v,old*x);
     else if(sub===0x84){if(x)write(v,Math.trunc(old/x));}
     else if(sub===0x85)write(v,x>=0?old<<x:old>>-x);
     else if(sub===0x87)write(v,old&x);
     else if(sub===0x88)write(v,old|x);
     else if(sub===0x89)write(v,old^x);
     else if(x)write(v,old%x);
    }
    else if(sub>=0x90&&sub<=0x95){const old=read(v);state.condition=[old===x,old>=x,old>x,old<=x,old<x,old!==x][sub-0x90];}
    else throw new Error('Unhandled math 0x'+sub.toString(16));
   }
   else if(op===0x80)t+=arg('vlq')*60/state.tempo/state.timebase;
   else if(op===0x81)state.program=arg('vlq');
   else if(op===0x88){byte();queue.push([addr(),t]);}
   else if(op===0x89)pc=addr();
   else if(op===0x8a){const a=addr();stack.push(pc);pc=a;}
   else if(op===0xfd){if(!stack.length)break;pc=stack.pop();}
   else if(op===0xff)break;
   else if(op===0xfb){for(const name of ['attack','decay','sustain','release'])delete state[name];}
   else if(op===0xfe)arg('short');
   else if(op===0xd4)loops.push([pc,arg(),0]);
   else if(op===0xfc){
    const l=loops[loops.length-1];l[2]++;
    if(l[2]<l[1])pc=l[0]+1;else loops.pop();
   }
   else if(op>=0xb0&&op<=0xdf){
    let v=arg();const ramp=arg2?arg('short'):0;
    if((op===0xc3||op===0xc4)&&v>=128)v-=256;
    if(op===0xb0)player.timebase=v;
    const name=NAMES[op];
    if(name){
     if(LIVE.includes(name)){
      const seconds=ramp*60/state.tempo/state.timebase;
      if(ramp)moves.set(name,[current(name,t),v,t,seconds]);else moves.delete(name);
      live=live.filter(n=>t<n.time+n.duration+RELEASE);
      for(const n of live)(n.changes??=[]).push([t-n.time,name,v,seconds]);
     }
     else if(ramp)throw new Error(`timed ${name} at ${at.toString(16)} is not modelled`);
     state[name]=v;
     if(random_!==null)pending[name]=random_;
    }
    else if(op!==0xc6&&op!==0xde)throw new Error(`unhandled ${op.toString(16)} at ${at.toString(16)}`);
   }
   else if(op>=0xe0&&op<=0xe3){
    const v=arg('short');
    if(op===0xe1)state.tempo=player.tempo=v;
    else if(op===0xe3||op===0xe0)state[op===0xe3?'sweepPitch':'lfoDelay']=v;
    else throw new Error(`unhandled ${op.toString(16)} at ${at.toString(16)}`);
   }
   else throw new Error(`unhandled ${op.toString(16)} at ${at.toString(16)}`);
  }
 }
 return notes;
}
