import struct,sys
segs={}
for n,b in {'text':0x100000,'rodata':0x39a000,'data':0x521000}.items(): segs[n]=(b,open(f'/home/user/RH_Fever_Browser/build/ctr/code-{n}.bin','rb').read())
def rd(a):
    for b,d in segs.values():
        if b<=a<b+len(d)-3: return struct.unpack_from('<I',d,a-b)[0]
a=int(sys.argv[1],16); n=int(sys.argv[2])
for i in range(n):
    h=rd(a); op=h&0x3ff; argc=(h>>10)&15; arg0=h>>14
    args=[rd(a+4+4*k) for k in range(argc)]
    print(f"{a:x}: op {op:x} arg0 {arg0:x} " + ' '.join(f'{x:x}' for x in args))
    a+=4+4*argc
