#!/usr/bin/env python3
"""Decode one game's original samples and trace its short RSEQ sound programs.
Every extracted bank (the game's and the shared system bank) is merged into one list of
waves and programs; each sound's notes point at programs of the bank its record names.
Random RSEQ parameters are retained as ranges for the browser adapter.
"""
import collections,json,math,struct
from nintendo_audio import wave_files,decode_wave,write_wav,u32
from paths import DOL,assets,game
out=assets(game())
assets=json.loads((out/'original-assets.json').read_text())
files=assets['audio']['files']
waves=[];programs=[];first_program={}
for bankid in [k for k,v in files.items() if v['magic']=='RBNK']:
 first_wave=len(waves);first_program[int(bankid)]=len(programs)
 for b in wave_files((out/f'wave-{bankid}.bin').read_bytes()):
  pcm,m=decode_wave(b);m['file']=f'sfx-{len(waves)}.wav';write_wav(out/m['file'],pcm,m['rate']);waves.append(m)
 bank=(out/f'file-{bankid}.bin').read_bytes();base=u32(bank,16)+8
 for i in range(u32(bank,base)):
  p=base+u32(bank,base+8+i*8)
  programs.append({'wave':first_wave+u32(bank,p),'attack':bank[p+4],'decay':bank[p+5],'sustain':bank[p+6],'release':bank[p+7],'hold':bank[p+8],'key':bank[p+12],'volume':bank[p+13],'pan':bank[p+14],'pitch':struct.unpack_from('>f',bank,p+16)[0]})
used=set()
# Sequences that change tempo after other tracks may have started (not modelled: none expected).
late_tempo=set()
# Variables 16-31 are the sequence player's globals, shared by every sequence and kept between
# sounds (nw4r SeqPlayer); a game's user procedure (F0 E0, its SeqUserprocCallback) also sets
# them. A sound whose notes depend on a global, on its user procedure or on a random variable
# is dynamic: web/engine/sequence.mjs traces it again when it plays, from the globals then. The
# notes kept for it here assume globals left at -1 (nw4r's default). A sound that only sets
# globals keeps what it sets, for the browser to apply when it plays.
GLOBALS=range(16,32)
def s16(x):return (x+0x8000&0xffff)-0x8000
def trace(seq,start,bank_programs):
 notes=[];queue=[(start,0)];tracks=0;variables=collections.defaultdict(lambda:-1);info={'dynamic':False,'globals':{}}
 def read(v):
  if v in GLOBALS:info['dynamic']=True
  return variables[v]
 def write(v,x):
  variables[v]=x=s16(x)
  if v in GLOBALS:info['globals'][v]=x
 # Tempo and timebase belong to the sequence player, not to a track: tracks opened by the
 # first one (echo layers, for example) run at the tempo it set.
 player={'tempo':120,'timebase':48}
 while queue:
  pc,t=queue.pop(0);state={'program':0,'volume':127,'volume2':127,'pan':64,'transpose':0,'bend':0,'bendRange':2,'noteWait':1,**player};stack=[];loops=[];pending={};steps=0
  def byte():
   nonlocal pc
   x=seq[pc];pc+=1;return x
  def vlq():
   v=0
   while True:
    x=byte();v=v*128+(x&127)
    if x<128:return v
  def addr():return byte()*65536+byte()*256+byte()
  while True:
   steps+=1
   if steps>10000:raise ValueError('runaway')
   at=pc;op=byte();random=None;arg2=False;argkind=None;execute=True
   if op==0xa2:op=byte();execute=state.get('condition',1)
   if op in [0xa0,0xa1]:argkind=op;op=byte()
   if op==0xa3:op=byte();arg2=True
   def arg(kind='byte'):
    nonlocal random
    if argkind==0xa0:
     lo=int.from_bytes(seq[pc:pc+2],'big',signed=True);hi=int.from_bytes(seq[pc+2:pc+4],'big',signed=True)
     for _ in range(4):byte()
     random=[lo,hi];return (lo+hi)//2
    if argkind==0xa1:return read(byte())
    return vlq() if kind=='vlq' else ((byte()<<8)|byte()) if kind=='short' else byte()
   # A conditional command (0xa2) whose condition is false is read past and not run.
   if not execute:
    if op<0x80:byte();arg('vlq')
    elif op in (0x80,0x81):arg('vlq')
    elif op==0x88:byte();addr()
    elif op in (0x89,0x8a):addr()
    elif 0xb0<=op<=0xdf:
     arg()
     if arg2:arg('short')
    elif 0xe0<=op<=0xe3 or op==0xfe:arg('short')
    elif op==0xf0:
     if byte()!=0xe0:byte()
     arg('short')
    elif op not in (0xfb,0xfc,0xfd,0xff):raise ValueError(f'unhandled conditional {op:x} at {at:x}')
    continue
   if op<0x80:
    velocity=byte();length=arg('vlq');p=programs[bank_programs+state['program']];rate=2**((op+state['transpose']-p['key']+state['bend']/128*state['bendRange'])/12)*p['pitch']
    duration=length*60/state['tempo']/state['timebase'] if length else waves[p['wave']]['samples']/waves[p['wave']]['rate']/rate
    notes.append(dict(state,program=bank_programs+state['program'],time=t,note=op,velocity=velocity,length=length,duration=duration,random=pending.copy()))
    if state['noteWait']:t+=duration
   elif op==0xf0:
    # nw4r MmlParser's extended commands: variable math and compares, and the user procedure.
    sub=byte()
    if sub==0xe0:
     proc=arg('short')
     if proc:raise ValueError(f'user procedure {proc} at {at:x} is not modelled')
     if execute:info['dynamic']=True
     continue
    v=byte();x=arg('short')
    if execute:
     if sub==0x80:write(v,x)
     elif sub==0x86:info['dynamic']=True;write(v,0)
     elif sub==0x8a:write(v,~x)
     elif sub in (0x81,0x82,0x83,0x84,0x85,0x87,0x88,0x89,0x8b):
      old=read(v)
      if sub==0x81:write(v,old+x)
      elif sub==0x82:write(v,old-x)
      elif sub==0x83:write(v,old*x)
      elif sub==0x84:
       if x:write(v,int(old/x))
      elif sub==0x85:write(v,old<<x if x>=0 else old>>-x)
      elif sub==0x87:write(v,old&x)
      elif sub==0x88:write(v,old|x)
      elif sub==0x89:write(v,old^x)
      elif x:write(v,int(math.fmod(old,x)))
     elif sub in [0x90,0x91,0x92,0x93,0x94,0x95]:old=read(v);state['condition']={0x90:old==x,0x91:old>=x,0x92:old>x,0x93:old<=x,0x94:old<x,0x95:old!=x}[sub]
     else:raise ValueError('Unhandled math '+hex(sub))
   elif op==0x80:t+=arg('vlq')*60/state['tempo']/state['timebase']
   elif op==0x81:state['program']=arg('vlq')
   elif op==0x88:track=byte();queue.append((addr(),t))
   elif op==0x89:pc=addr()
   elif op==0x8a:
    a=addr();stack.append(pc);pc=a
   elif op==0xfd:
    if not stack:break
    pc=stack.pop()
   elif op==0xff:break
   elif op==0xfb:
    for name in ['attack','decay','sustain','release']:state.pop(name,None)
   elif op==0xfe:arg('short')
   elif op==0xd4:loops.append([pc,arg(),0])
   elif op==0xfc:
    l=loops[-1];l[2]+=1
    if l[2]<l[1]:pc=l[0]+1
    else:loops.pop()
   elif 0xb0<=op<=0xdf:
    v=arg();ramp=arg('short') if arg2 else 0;used.add(hex(op))
    names={0xb0:'timebase',0xc0:'pan',0xc1:'volume',0xc2:'playerVolume',0xc3:'transpose',0xc4:'bend',0xc5:'bendRange',0xc7:'noteWait',0xd0:'attack',0xd1:'decay',0xd2:'sustain',0xd3:'release',0xd5:'volume2',0xd8:'lpf',0xd9:'fxA',0xda:'fxB',0xdb:'mainSend',0xdd:'mute',0xdf:'damper',0xdc:'initPan',0xc8:'tie',0xc9:'portamento',0xce:'portaSpeed',0xcf:'portaTime',0xca:'lfoDepth',0xcb:'lfoSpeed',0xcc:'lfoTarget',0xcd:'lfoRange',0xb1:'hold',0xb2:'monophonic',0xb3:'velocityRange',0xb4:'biquadType',0xb5:'biquadValue'}
    if op in (0xc3,0xc4) and v>=128:v-=256
    if op==0xb0:
     if t or tracks:late_tempo.add(start)
     player['timebase']=v
    if op in names:
     if ramp:pending[names[op]+'Ramp']={'from':state.get(names[op],0),'to':v,'time':t,'seconds':ramp*60/state['tempo']/state['timebase']}
     state[names[op]]=v
     if random is not None:pending[names[op]]=random
    elif op not in [0xc6,0xde]:raise ValueError(f'unhandled {op:x} at {at:x}')
   elif 0xe0<=op<=0xe3:
    v=arg('short');used.add(hex(op))
    if op==0xe1:
     if t or tracks:late_tempo.add(start)
     state['tempo']=player['tempo']=v
    elif op in [0xe3,0xe0]:state['sweepPitch' if op==0xe3 else 'lfoDelay']=v
    else:raise ValueError(f'unhandled {op:x} at {at:x}')
   else:raise ValueError(f'unhandled {op:x} at {at:x}')
  tracks+=1
 return notes,info
# The game's sequence tempo table (lbl_802E8720 in src/Game/SoundData.inc, installed by
# main.cpp): CSoundManager::play stretches a listed sequence by the chart tempo over the tempo
# it was written at (calc_seq_tempo_sound_id, tune_tempo_rel).
dol=DOL.read_bytes()
def dol_offset(address):
 for i in range(18):
  start,size=u32(dol,0x48+i*4),u32(dol,0x90+i*4)
  if start<=address<start+size:return u32(dol,i*4)+address-start
TEMPO_TABLE,TEMPO_TABLE_SIZE=0x802E8720,0xE40
tempo_table=[struct.unpack_from('>3H',dol,dol_offset(TEMPO_TABLE)+i*6) for i in range(TEMPO_TABLE_SIZE//6)]
def seq_tempo(sid):
 prev=0
 for sound,kind,value in tempo_table:
  if kind!=3:prev=sound
  if sound==sid:
   if kind==0:return value
   if kind==2:return seq_tempo(value)
   if kind==3:return seq_tempo(prev)
   return None  # tempo from a wave's info (eType_WaveInfoRef): not modelled
 return None
sounds={}
for seqid in [k for k,v in files.items() if v['magic']=='RSEQ']:
 b=(out/f'file-{seqid}.bin').read_bytes();seq=b[u32(b,16)+u32(b,u32(b,16)+8):]
 # The sequence's data block, which the browser traces dynamic sounds from (sequence.mjs).
 (out/f'sequence-{seqid}.bin').write_bytes(seq)
 for sid,s in assets['audio']['sounds'].items():
  if s['type']!=1 or s['fileId']!=int(seqid):continue
  if s['bankFile'] not in first_program:raise SystemExit(f"{s['name']}: its bank (file {s['bankFile']}) was not extracted")
  notes,info=trace(seq,s['data'][0],first_program[s['bankFile']])
  sounds[sid]={'name':s['name'],'volume':s['volume'],'tempo':seq_tempo(int(sid)),'notes':notes}
  sounds[sid]['sequence']={'file':f'sequence-{seqid}.bin','start':s['data'][0],'bank':first_program[s['bankFile']]}
  if info['dynamic']:sounds[sid]['dynamic']=True
  elif info['globals']:sounds[sid]['globals']={str(k):v for k,v in sorted(info['globals'].items())}
(out/'sfx.json').write_text(json.dumps({'waves':waves,'programs':programs,'sounds':sounds},indent=2)+'\n')
if late_tempo:raise SystemExit(f'Tempo changes mid-sequence are not modelled (sequence offsets {sorted(late_tempo)})')
print(json.dumps({'samples':len(waves),'programs':len(programs),'sounds':len(sounds),'commands':sorted(used),'notes':sum(len(s['notes']) for s in sounds.values())}))
