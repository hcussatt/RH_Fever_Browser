"""Execute the supplied disc's original PPC judgment bytes, without translating its rules."""
import sys,struct,json,hashlib,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'python'))
from unicorn import Uc,UC_ARCH_PPC,UC_MODE_32,UC_MODE_BIG_ENDIAN,UC_HOOK_CODE
from unicorn.ppc_const import *
spec=importlib.util.spec_from_file_location('dol',HERE/'inspect-original.py');dol=importlib.util.module_from_spec(spec);spec.loader.exec_module(dol)
ENTRY=0x801e7eb0; STOP=0x817ff000; OBJ=0x81600000; OUT=OBJ+0x200
F32=lambda x:struct.unpack('>f',struct.pack('>f',x))[0]
def bits64(x):return struct.unpack('>Q',struct.pack('>d',x))[0]
class OriginalJudge:
 def __init__(self):
  self.uc=Uc(UC_ARCH_PPC,UC_MODE_32|UC_MODE_BIG_ENDIAN)
  self.uc.mem_map(0x80000000,0x1800000)
  for off,addr,size in dol.SECTIONS:self.uc.mem_write(addr,dol.data[off:off+size])
  self.uc.reg_write(UC_PPC_REG_MSR,0x2000)
  self.uc.reg_write(UC_PPC_REG_1,0x817fe000);self.uc.reg_write(UC_PPC_REG_2,0x80328fe0)
  self.uc.reg_write(UC_PPC_REG_13,0x80326ec0)
  self.override_lag=None
  self.uc.hook_add(UC_HOOK_CODE,self.hook,begin=0x801e7ee8,end=0x801e7ee8)
 def hook(self,uc,pc,size,user):
  if self.override_lag is not None:uc.reg_write(UC_PPC_REG_FPR0,bits64(self.override_lag))
 def run(self,event_tick,delay=0,age=None,correct=False,resolved=False,penalty=False,windows=(-10.,-6.,6.,10.)):
  uc=self.uc;obj=bytearray(0x100)
  # Tap Trial creates checkers at target=48 with these exact windows.
  struct.pack_into('>7f',obj,0x54,F32(event_tick+delay),48.,*windows,0.)
  obj[0x71]=int(resolved);struct.pack_into('>I',obj,0x74,2)
  uc.mem_write(OBJ,bytes(obj));uc.mem_write(OUT,b'\xff')
  uc.reg_write(UC_PPC_REG_3,OBJ);uc.reg_write(UC_PPC_REG_4,OUT);uc.reg_write(UC_PPC_REG_5,int(penalty))
  uc.reg_write(UC_PPC_REG_FPR1,bits64(F32(0. if age is None else age)))
  uc.reg_write(UC_PPC_REG_LR,STOP)
  self.override_lag=F32(F32(event_tick)-48.) if correct else None
  uc.emu_start(ENTRY,STOP,count=1000)
  result={'classification':uc.reg_read(UC_PPC_REG_3),'points':uc.mem_read(OUT,1)[0],
          'resolved':bool(uc.mem_read(OBJ+0x71,1)[0]),'state':struct.unpack('>I',uc.mem_read(OBJ+0x74,4))[0],
          'lag':struct.unpack('>f',uc.mem_read(OBJ+0x6c,4))[0]}
  return result
if __name__=='__main__':
 j=OriginalJudge()
 print(json.dumps({'onTime':j.run(48.),'delayed':j.run(48.,delay=8.),'corrected':j.run(48.,delay=8.,correct=True),'alreadyResolved':j.run(48.,delay=12.,correct=True,resolved=True)},indent=2))
