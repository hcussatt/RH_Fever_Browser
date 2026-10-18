import sys, struct
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import DOL, require
DOL=require(DOL)
data=DOL.read_bytes()
def u32(o): return struct.unpack_from('>I', data, o)[0]
SECTIONS=[(u32(i*4),u32(0x48+i*4),u32(0x90+i*4)) for i in range(18) if u32(0x90+i*4)]
def read(addr,n):
 for offset,start,size in SECTIONS:
  if start<=addr and addr+n<=start+size:return data[offset+addr-start:offset+addr-start+n]
 raise ValueError(hex(addr))
if __name__=='__main__':
 from capstone import Cs, CS_ARCH_PPC, CS_MODE_32, CS_MODE_BIG_ENDIAN
 cs=Cs(CS_ARCH_PPC,CS_MODE_32|CS_MODE_BIG_ENDIAN);cs.skipdata=True
 addr=int(sys.argv[1],0);size=int(sys.argv[2],0)
 for x in cs.disasm(read(addr,size),addr):print(f'{x.address:08x} {x.bytes.hex():8} {x.mnemonic:10} {x.op_str}')
