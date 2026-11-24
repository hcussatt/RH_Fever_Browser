import json,pathlib,importlib.util,sys,re
spec=importlib.util.spec_from_file_location('ar','tools/arm_recompile.py');ar=importlib.util.module_from_spec(spec);spec.loader.exec_module(ar)
C=pathlib.Path('build/ctr');info=json.loads((C/'code.json').read_text())
mem=ar.Memory([(info[s]['address'],(C/f'code-{s}.bin').read_bytes(),s!='data') for s in ('text','rodata','data')])
base=[0x100000,0x1dc08c]+[int(x,0) for x in open('tools/ctr-harness/ents.txt').read().split()]
base+=[int(x,0) for x in open('tools/ctr-harness/init.txt').read().split()]+[int(x,0) for x in open('tools/ctr-harness/extra.txt').read().split()]
cands=[int(x,0) for x in open('tools/ctr-harness/cands.txt').read().split()]
dec=ar.Decoder(mem)
SERV=[int(x,0) for x in open("tools/ctr-harness/services.txt").read().split()]
f,_=ar.find_functions(dec,base,stop=SERV)
bad=[]
for c in cands:
    if c in f: continue
    try:
        g,_=ar.find_functions(dec,[c],stop=set(f)|set(SERV))
        f.update(g)
    except ar.Unsupported as e:
        bad.append((c,str(e)[:100]))
print(len(f),'functions;',len(bad),'candidates dropped')
for c,e in bad[:15]: print(hex(c),e)
ar.write(f,None,'build/ctr/blanco.inc')
