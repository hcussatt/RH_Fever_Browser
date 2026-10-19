#!/usr/bin/env python3
"""Experimental function-level PPC-to-C bridge for the standalone game PoCs.

Original instructions remain the behavioral reference while readable recovery
continues. This is static recompilation, not a claim of completed decompilation.
Unsupported instructions fail the build; unsupported external calls trap.
"""
import re,struct,json,subprocess,os,tempfile
from paths import BUILD,DECOMP,DOL,assets,game,manifest,require
GAME=game()
blob=require(DOL).read_bytes()
u32=lambda o:struct.unpack_from('>I',blob,o)[0]
sections=[(u32(i*4),u32(0x48+i*4),u32(0x90+i*4)) for i in range(18) if u32(0x90+i*4)]
def read(a,n):
    for off,start,size in sections:
        if start<=a and a+n<=start+size:return blob[off+a-start:off+a-start+n]
    raise ValueError(hex(a))

SHARED={'GameUtil/TickFlow.cpp','nw4r/snd/snd_EnvGenerator.cpp','GameUtil/TimeRatio.cpp','GameUtil/InputChecker.cpp','Game/ExChecker.cpp','GameUtil/CellAnim.cpp','GameUtil/Random.cpp'}
# Single pure functions outside those units that the chart interpreter needs.
SHARED_FUNCTIONS={'calc_initial_wave_tempo__13CSoundManagerFP8WaveInfo',
  'fn_80009950__8CExSceneFll','fn_80009A40__8CExSceneFb', # the "you" marker's position and visibility
  'CalcVolumeRatio__Q44nw4r3snd6detail4UtilFf'} # decibels to amplitude, for sound envelopes
# Each game's manifest names the original units whose functions are translated.
units=set(manifest(GAME)['wii']['units'])|SHARED
ranges=[];unit=None
for line in (DECOMP/'config/SOME01/splits.txt').read_text().splitlines():
    if line and not line[0].isspace() and line.endswith(':'):unit=line[:-1]
    m=re.match(r'\s*\.text\s+start:(0x\w+) end:(0x\w+)',line)
    if m and unit in units:ranges.append((int(m[1],0),int(m[2],0),unit))
symbols={};funcs=[]
for line in (DECOMP/'config/SOME01/symbols.txt').read_text().splitlines():
    m=re.match(r'(.+?) = [^:]+:(0x\w+);.*',line)
    if not m:continue
    name,a=m[1],int(m[2],0);symbols[name]=a
    size=re.search(r'type:function size:(0x\w+)',line)
    if size and (any(lo<=a<hi for lo,hi,_ in ranges) or name in SHARED_FUNCTIONS):funcs.append((a,int(size[1],0),name))
# Disassemble the DOL's text sections directly. Gekko mode is required:
# default binutils reads paired-single instructions as unrelated VSX ones.
objdump=os.environ.get('RHF_OBJDUMP','powerpc-eabi-objdump')
text=''
with tempfile.TemporaryDirectory() as tmp:
    for i in range(7):
        off,start,size=u32(i*4),u32(0x48+i*4),u32(0x90+i*4)
        if not size:continue
        part=os.path.join(tmp,f'text{i}.bin')
        with open(part,'wb') as f:f.write(blob[off:off+size])
        text+=subprocess.check_output([objdump,'-D','-b','binary','-m','powerpc:common','-EB','-M','gekko',f'--adjust-vma={start:#x}',part],text=True)
decoded={}
for line in text.splitlines():
    m=re.match(r'\s*([0-9a-f]+):\s+(?:[0-9a-f]{2} ){3}[0-9a-f]{2}\s+(\S+)\s*(.*)',line)
    if not m:continue
    address=int(m[1],16);mnemonic=m[2].rstrip('+-');ops=m[3].split('<')[0].strip()
    if mnemonic.startswith('b') and ops:
        fields=ops.split(',');target=fields[-1].strip()
        if re.fullmatch('[0-9a-f]{8}',target):fields[-1]='0x'+target
        ops=','.join(fields)
    decoded[address]=type('Instruction',(),dict(address=address,mnemonic=mnemonic,op_str=ops))

def reg(s):
    if re.fullmatch('r[0-9]+',s):return 'r['+s[1:]+']'
    if re.fullmatch('f[0-9]+',s):return 'f['+s[1:]+'].d'
    try:return str(int(s,0))
    except ValueError:return s
def fpbits(s):return 'f['+s[1:]+'].u'
def ea(s):
    m=re.fullmatch(r'(-?0x[0-9a-f]+|-?\d+)\((r\d+)\)',s)
    if not m:raise ValueError('EA '+s)
    return '('+('0' if m[2]=='r0' else reg(m[2]))+'+('+reg(m[1])+'))'
def crbit(s):
    if s.isdigit():return int(s)
    m=re.fullmatch(r'4\*cr(\d)\+(lt|gt|eq|so)',s)
    if m:return int(m[1])*4+{'lt':0,'gt':1,'eq':2,'so':3}[m[2]]
    return {'lt':0,'gt':1,'eq':2,'so':3}.get(s,-1)

def generate(a,size,name):
    insns=[decoded[pc] for pc in range(a,a+size,4)];addresses={i.address for i in insns}
    assert len(insns)*4==size,(name,size,len(insns))
    lines=[f'static void p_{a:x}(void) {{']
    jumps=[]
    for x in insns:
        m=x.mnemonic;record=m.endswith('.');m=m.rstrip('.')
        p=[s.strip() for s in x.op_str.split(',')] if x.op_str else []
        q=[reg(s) if '(' not in s and not s.startswith('cr') else s for s in p]
        c='';field=0
        if m in ['lwz','lhz','lha','lbz','lfd','lfs']:
            v={'lwz':'rd32','lhz':'rd16','lha':'rds16','lbz':'rd8','lfd':'rdf64','lfs':'rdf32'}[m]
            c=f'{q[0]}={v}({ea(p[1])});'
        elif m in ['stw','sth','stb','stfd','stfs','stwu']:
            v={'stw':'wr32','sth':'wr16','stb':'wr8','stfd':'wr64','stfs':'wrf32','stwu':'wr32'}[m]
            value=fpbits(p[0]) if m=='stfd' else q[0]
            c=f'{v}({ea(p[1])},{value});'
            if m=='stwu':
                base_register=re.search(r'r\d+',p[1])[0]
                c+=f'{reg(base_register)}={ea(p[1])};'
        elif m in ['lmw','stmw']:
            start=int(p[0][1:]);address=ea(p[1])
            c='{uint32_t address='+address+';'+''.join((f'r[{j}]=rd32(address+{(j-start)*4});' if m=='lmw' else f'wr32(address+{(j-start)*4},r[{j}]);') for j in range(start,32))+'}'
        elif m in ['lwzx','lhax','lhzx','lbzx','lfsx','lfdx','stwx','sthx','stbx','stfsx','stfdx']:
            addr=f'({q[1]}+{q[2]})'
            loads={'lwzx':'rd32','lhax':'rds16','lhzx':'rd16','lbzx':'rd8','lfsx':'rdf32','lfdx':'rdf64'}
            stores={'stwx':'wr32','sthx':'wr16','stbx':'wr8','stfsx':'wrf32','stfdx':'wr64'}
            c=f'{q[0]}={loads[m]}({addr});' if m in loads else f'{stores[m]}({addr},{fpbits(p[0]) if m=="stfdx" else q[0]});'
        elif m=='lwzux':
            c=f'{{uint32_t address={q[1]}+{q[2]};{q[0]}=rd32(address);{q[1]}=address;}}'
        elif m in ['li','lis','mr','fmr']:
            c=f'{q[0]}={q[1]}' + ('*65536u;' if m=='lis' else ';')
        elif m in ['addi','subi','addis','add','subf','mulli','mullw','or','xor','xoris','and','andc','nor']:
            if m=='addis':v=f'{q[1]}+({q[2]}*65536u)'
            elif m in ['addi','add']:v=f'{q[1]}+({q[2]})'
            elif m=='subi':v=f'{q[1]}-({q[2]})'
            elif m=='subf':v=f'{q[2]}-{q[1]}'
            elif m in ['mulli','mullw']:v=f'{q[1]}*({q[2]})'
            elif m=='or':v=f'{q[1]}|{q[2]}'
            elif m=='xor':v=f'{q[1]}^{q[2]}'
            elif m=='xoris':v=f'{q[1]}^({q[2]}*65536u)'
            elif m=='and':v=f'{q[1]}&{q[2]}'
            elif m=='andc':v=f'{q[1]}&~{q[2]}'
            elif m=='nor':v=f'~({q[1]}|{q[2]})'
            c=f'{q[0]}={v};'
        elif m in ['neg','cntlzw','extsh','extsb']:
            v={'neg':f'-{q[1]}','cntlzw':f'({q[1]}?__builtin_clz({q[1]}):32)','extsh':f'(int16_t){q[1]}','extsb':f'(int8_t){q[1]}'}[m]
            c=f'{q[0]}={v};'
        elif m in ['srwi','slwi','srawi','clrlwi','rlwinm']:
            if m=='srwi':v=f'{q[1]}>>{q[2]}'
            elif m=='slwi':v=f'{q[1]}<<{q[2]}'
            elif m=='srawi':
                v=f'(int32_t){q[1]}>>{q[2]}'
                c=f'carry=((int32_t){q[1]}<0 && ({q[1]} & ((1u<<{q[2]})-1)));'
            elif m=='clrlwi':v=f'{q[1]} & {hex((1<<(32-int(p[2],0)))-1)}u'
            else:
                mb,me=int(p[3],0),int(p[4],0);mask=0;i=mb
                while True:
                    mask|=1<<(31-i)
                    if i==me:break
                    i=(i+1)%32
                v=f'rotl({q[1]},{q[2]})&{hex(mask)}u'
            c+=f'{q[0]}={v};'
        elif m=='rlwimi':
            mb,me=int(p[3],0),int(p[4],0);mask=0;i=mb
            while True:
                mask|=1<<(31-i)
                if i==me:break
                i=(i+1)%32
            c=f'{q[0]}=(rotl({q[1]},{q[2]})&{hex(mask)}u)|({q[0]}&{hex(~mask&0xffffffff)}u);'
        elif m in ['mulhw','mulhwu']:
            cast='int64_t)(int32_t' if m=='mulhw' else 'uint64_t)(uint32_t'
            c=f'{q[0]}=((({cast}){q[1]})*(({cast}){q[2]}))>>32;'
        elif m in ['addc','adde','addze','subfc','subfe','subfic']:
            if m=='addze':v=f'(uint64_t){q[1]}+carry'
            elif m in ['addc','adde']:v=f'(uint64_t){q[1]}+{q[2]}' + ('+carry' if m=='adde' else '')
            elif m=='subfic':v=f'(uint64_t)(uint32_t)({q[2]})+(uint32_t)~{q[1]}+1'
            else:v=f'(uint64_t){q[2]}+(uint32_t)~{q[1]}+'+('carry' if m=='subfe' else '1')
            c=f'{{uint64_t v={v};{q[0]}=(uint32_t)v;carry=v>>32;}}'
        elif m in ['cmpwi','cmpw','cmplwi','cmplw']:
            if p[0].startswith('cr'):field=int(p[0][2:]);q=q[1:]
            typ='uint32_t' if m.startswith('cmpl') else 'int32_t'
            c=f'cmp({field},({typ}){q[0]},({typ})({q[1]}));'
        elif m in ['fcmpo','fcmpu']:
            if p[0].startswith('cr'):field=int(p[0][2:]);q=q[1:]
            c=f'fcmp({field},{q[0]},{q[1]});'
        elif m in ['cror','crclr']:
            bits=[crbit(s) for s in p]
            assert min(bits)>=0,(m,p)
            c=f'cr[{bits[0]}]='+(f'cr[{bits[1]}]|cr[{bits[2]}];' if m=='cror' else '0;')
        elif m=='mfcr':
            # CR bit 0 (cr0 lt) is the most significant bit.
            c=f'{{uint32_t v=0;for(int i=0;i<32;i++)v=v<<1|cr[i];{q[0]}=v;}}'
        elif m in ['fadds','fsubs','fmuls','fdivs','fadd','fsub','fmul','fdiv']:
            op={'add':'+','sub':'-','mul':'*','div':'/'}[m[1:4]]
            c=f'{q[0]}='+('(float)' if m.endswith('s') else '')+f'({q[1]}{op}{q[2]});'
        elif m in ['fmadds','fmadd','fmsub','fmsubs','fnmsub','fnmsubs','fnmadd','fnmadds']:
            fn='fmaf' if m.endswith('s') else 'fma'
            neg=m.startswith('fn');subtract='msub' in m
            c=f'{q[0]}='+('-' if neg else '')+f'{fn}({q[1]},{q[2]},{"-" if subtract else ""}{q[3]});'
        elif m=='nop':c=';'
        elif m=='fneg':c=f'{q[0]}=-{q[1]};'
        elif m=='fabs':c=f'{q[0]}=fabs({q[1]});'
        elif m=='fnabs':c=f'{q[0]}=-fabs({q[1]});'
        elif m=='frsp':c=f'{q[0]}=(float){q[1]};'
        elif m=='fctiwz':c=f'{fpbits(p[0])}=0xfff8000000000000ull|(uint32_t)(int32_t){q[1]};'
        elif m in ['psq_st','psq_l']:
            # GQR0 prologue/epilogue paired-single saves are redundant here:
            # the adjacent stfd/lfd preserves PS0, and no gameplay PS1 ops occur.
            assert p[-1] in ('0','qr0'),(m,p)
            c=';'
        elif m=='mflr':c=f'{q[0]}=lr;'
        elif m=='mtlr':c=f'lr={q[0]};'
        elif m=='mtctr':c=f'ctr={q[0]};'
        elif m in ['b','bl']:
            target=int(p[0],0)
            if target in addresses and m=='b':c=f'goto L_{target:x};'
            else:c=(f'lr=0x{x.address+4:x};call(0x{target:x});' + ('return;' if m=='b' else ''))
        elif m in ['blr','bctrl','bctr']:
            if m=='blr':c='return;'
            elif m=='bctrl':c=f'lr=0x{x.address+4:x};call(ctr);'
            else:c='goto indirect;';jumps.append(x.address)
        elif re.fullmatch(r'b(eq|ne|lt|gt|le|ge)(lr)?',m) or m=='bdnz':
            operands=p
            if operands and operands[0].startswith('cr'):
                field=int(operands[0][2:]);operands=operands[1:]
            if m=='bdnz':condition='--ctr'
            else:
                cond=m[1:3]
                condition={'eq':f'cr[{field*4+2}]','ne':f'!cr[{field*4+2}]','lt':f'cr[{field*4}]','ge':f'!cr[{field*4}]','gt':f'cr[{field*4+1}]','le':f'!cr[{field*4+1}]'}[cond]
            action='return;' if m.endswith('lr') else f'goto L_{int(operands[0],0):x};'
            c=f'if({condition}){{{action}}}'
        else:raise ValueError(f'Unsupported {x.address:x}: {m} {x.op_str}')
        if record:c+=f'cmp(0,(int32_t){q[0]},0);'
        lines.append(f'L_{x.address:x}: {c}')
    if jumps:
        lines.append('indirect: switch(ctr){')
        lines.extend(f'case 0x{i:x}:goto L_{i:x};' for i in sorted(addresses))
        lines.append('default:call(ctr);return;}')
    lines.append('}')
    return '\n'.join(lines)

out=BUILD/GAME;out.mkdir(parents=True,exist_ok=True)
generated=['/* Generated from the user-provided original DOL; see docs/golf-notes.md. */']
generated.extend(f'static void p_{a:x}(void);' for a,_,_ in funcs)
generated.extend(generate(a,size,name) for a,size,name in funcs)
generated.append('static int dispatch_original(uint32_t address) {switch(address){')
generated.extend(f'case 0x{a:x}: p_{a:x}(); return 1;' for a,_,_ in funcs)
generated.append('default:return 0;}}')
(out/'original-functions.inc').write_text('\n'.join(generated)+'\n')
(out/'symbols.json').write_text(json.dumps(symbols,indent=2)+'\n')
segments=[]
for off,a,size in sections:
    if a>=0x801f0000:
        name=f'data-{a:08x}.bin';(assets(GAME)/name).write_bytes(blob[off:off+size]);segments.append({'address':a,'file':name,'size':size})
(assets(GAME)/'original-segments.json').write_text(json.dumps(segments,indent=2)+'\n')
print('Generated',len(funcs),'original functions,',sum(n for _,n,_ in funcs),'instruction bytes')
