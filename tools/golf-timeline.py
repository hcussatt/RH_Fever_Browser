#!/usr/bin/env python3
"""Trace the original Hole in One main-level bytecode without approximating its chart."""
import heapq
import json
import pathlib
import struct
import sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from importlib.machinery import SourceFileLoader
dol=SourceFileLoader('rhf_dol',str(ROOT/'tools/inspect-original.py')).load_module()
u32=lambda a:struct.unpack('>I',dol.read(a,4))[0]
s32=lambda x:x if x<0x80000000 else x-0x100000000
BEATS,SAMPLES,FLAGS,_=struct.unpack('>IIHH',dol.read(0x802e7fe0,12))
RATE=32000
seconds_per_tick=SAMPLES/RATE/(BEATS*48)

def instruction(address):
    word=u32(address);argc=(word>>10)&15
    args=[s32(u32(address+4+4*i)) for i in range(argc)]
    return word&1023,word>>14,args,address+4+argc*4

events=[];queue=[];next_id=0
def spawn(address,tick):
    global next_id
    t={'id':next_id,'root':address,'pc':address,'stack':[],'cond':0,'vars':[]}
    next_id+=1;heapq.heappush(queue,(tick,t['id'],t))

def skip(pc,otherwise):
    depth=0
    for _ in range(10000):
        op,a,args,n=instruction(pc)
        if op==0x10:depth+=1
        if op==0x12:
            if depth==0:return n
            depth-=1
        if otherwise and op==0x11 and depth==0:return n
        pc=n
    raise ValueError('Conditional scan exceeded bound')

spawn(0x802451b4,0)
steps=0;end_tick=None
while queue:
    tick,_,t=heapq.heappop(queue)
    if tick>BEATS*48+1000:break
    for _ in range(10000):
        pc=t['pc'];op,a,args,n=instruction(pc);t['pc']=n;steps+=1
        # Stop the root immediately before result/grade/UI processing.
        if t['id']==0 and pc==0x8024526c:
            end_tick=tick;break
        if op==0:
            spawn(args[0]&0xffffffff,tick+(args[1]&0xffffffff))
        elif op==1:
            t['stack'].append((t['root'],n));t['root']=args[0]&0xffffffff;t['pc']=t['root']
        elif op==2:
            if not t['stack']:break
            t['root'],t['pc']=t['stack'].pop()
        elif op==3:break
        elif op==4:pass
        elif op==5:t['cond']=args[0]
        elif op==6:t['cond']+=args[0]
        elif op==7:t['vars'].append(t['cond'])
        elif op==8:t['cond']=t['vars'].pop()
        elif op==9:
            tick+=a
            if a:
                heapq.heappush(queue,(tick,t['id'],t));break
        elif op==0xb:
            tick+=a/60/seconds_per_tick
            heapq.heappush(queue,(tick,t['id'],t));break
        elif op==0xc:tick-=a
        elif op==0xe:pass
        elif op==0xf:
            label=t['root']
            for _ in range(10000):
                lop,la,_,ln=instruction(label)
                if lop==0xe and la==a:t['pc']=ln;break
                label=ln
            else:raise ValueError('Missing label')
        elif op==0x10:
            c,v=t['cond'],args[0]
            if not [c==v,c!=v,c<v,c<=v,c>v,c>=v][a]:t['pc']=skip(n,True)
        elif op==0x11:t['pc']=skip(n,False)
        elif op==0x12:pass
        elif op in [0x22,0x23,0x39,0x42] or 0x100<=op<=0x141 or 0x200<=op<=0x20c:
            events.append({'tick':tick,'op':op,'arg0':a,'args':args,'address':hex(pc),'thread':t['id']})
        else:
            raise ValueError(f'Unimplemented original instruction {op:x}/{a} at {pc:x}')
    else:raise ValueError('Runaway bytecode')

events.sort(key=lambda e:e['tick'])
prelude=[]
pc=0x80245094
while pc<0x80245184:
    op,a,args,n=instruction(pc)
    if 0x200<=op<=0x20c:prelude.append({'op':op,'arg0':a,'args':args,'address':hex(pc)})
    pc=n
out={'prelude':prelude,'source':'Unmodified SOME01 DOL TickFlow bytes','startAddress':'0x802451b4','tempoAddress':'0x802e7fe0','beatCount':BEATS,'sampleCount':SAMPLES,'sampleRate':RATE,'secondsPerTick':seconds_per_tick,'endTick':end_tick,'events':events,'steps':steps}
from paths import assets
path=assets('golf')/'original-timeline.json';path.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'events':len(events),'steps':steps,'endTick':end_tick,'duration':SAMPLES/RATE,'checkers':sum(e['op']==0x200 for e in events),'opcodes':sorted(set(hex(e['op']) for e in events))},indent=2))
