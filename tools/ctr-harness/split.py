"""Split the translated program (build/ctr/blanco.inc) into compile units that build side by side.

One file of ~58 MB C is too big to compile in one go (clang runs out of memory). This writes
build/ctr/split/unit.h (shared declarations), part00.c ... partNN.c (function bodies) and tables.c
(the dispatch and resume tables, plus the entry points the harness calls).
Usage: python3 tools/ctr-harness/split.py [parts]
"""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parents[2]
src = root / 'build/ctr/blanco.inc'
out = root / 'build/ctr/split'
parts = int(sys.argv[1]) if len(sys.argv) > 1 else 24
out.mkdir(parents=True, exist_ok=True)

lines = src.read_text().split('\n')
first_body = next(i for i, l in enumerate(lines) if l.startswith('static void p_') and l.rstrip().endswith('{'))
tables = next(i for i, l in enumerate(lines) if l.startswith('static int resume_original'))
protos = [l.replace('static void p_', 'void p_') for l in lines[:first_body] if l.startswith('static void p_')]

# arm.h keeps the CPU state in file-level statics; across units they must be one shared definition.
arm = (root / 'adapters/ctr/arm.h').read_text()
state = re.findall(r'^static ((?:uint32_t|union \{[^}]*\})[^;]*?)(?: = [^;]*)?;', arm, re.M)
shared = re.sub(r'^static ((?:uint32_t|union \{[^}]*\})[^;]*?)( = [^;]*)?;', r'extern \1;', arm, flags=re.M)
definitions = re.sub(r'^static ((?:uint32_t|union \{[^}]*\})[^;]*?)( = [^;]*)?;', r'\1\2;', arm, flags=re.M)
definitions = '\n'.join(l for l in definitions.split('\n') if re.match(r'^(uint32_t|union \{)', l))
# Name the register-file union so the declaration and the definition have the same type.
shared = shared.replace('extern union {', 'extern union vfp_file {')
definitions = re.sub(r'^union \{[^}]*\} vfp;', 'union vfp_file vfp;', definitions, flags=re.M)

head = ['#include <stdint.h>',
        'uint32_t rd32(uint32_t),rd16(uint32_t),rd8(uint32_t);uint64_t rd64(uint32_t);',
        'void wr32(uint32_t,uint32_t),wr16(uint32_t,uint32_t),wr8(uint32_t,uint32_t),wr64(uint32_t,uint64_t);',
        'void call(uint32_t);void svc(uint32_t,uint32_t);uint32_t tls(void);void panic(uint32_t,int);',
        shared] + protos
(out / 'unit.h').write_text('\n'.join(head) + '\n')

# Function bodies: cut only where a new function starts.
starts = [i for i in range(first_body, tables) if lines[i].startswith('static void p_')]
starts.append(tables)
per = (len(starts) - 1 + parts - 1) // parts
for k in range(parts):
    a, b = starts[min(k * per, len(starts) - 1)], starts[min((k + 1) * per, len(starts) - 1)]
    body = '\n'.join(lines[a:b]).replace('\nstatic void p_', '\nvoid p_')
    if body.startswith('static void p_'): body = body[len('static '):]
    (out / f'part{k:02d}.c').write_text('#include "unit.h"\n' + body + '\n')

tail = '\n'.join(lines[tables:]).replace('static int resume_original', 'int resume_original').replace('static int dispatch_original', 'int dispatch_original')
(out / 'tables.c').write_text('#include "unit.h"\n' + definitions + '\n' + tail + '''
uint32_t *R=r;
int dispatch(uint32_t a){return dispatch_original(a);}
float *VFP=vfp.s;
int resume(uint32_t a){return resume_original(a);}
''')
print(f'{len(starts)-1} functions in {parts} parts')
