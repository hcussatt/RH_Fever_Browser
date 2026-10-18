#!/usr/bin/env python3
"""Readable instruction diff for one recovered function; objdiff remains authoritative."""
import difflib
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[1] / 'third_party/rhf-decomp'
unit, symbol = sys.argv[1:3]
objdump = root / 'build/binutils/powerpc-eabi-objdump'

def instructions(kind):
    path = root / 'build/SOME01' / kind / (unit + '.o')
    text = subprocess.check_output([str(objdump), '-d', str(path)], text=True)
    match = re.search(r'^([0-9a-f]+) <' + re.escape(symbol) + r'>:\n(.*?)(?=\n[0-9a-f]+ <|\Z)', text, re.M | re.S)
    if not match:
        raise SystemExit('Symbol not found in ' + str(path) + ': ' + symbol)
    start = int(match[1], 16)
    result = []
    for line in match[2].splitlines():
        insn = re.match(r'\s*([0-9a-f]+):\s+(?:[0-9a-f]{2} ){3}[0-9a-f]{2}\s+(.+)', line)
        if insn:
            asm = re.sub(r'\b[0-9a-f]+ (<[^>]+>)', r'\1', insn[2])
            result.append(f'{int(insn[1],16)-start:04x}: {asm}\n')
    return result

original, source = instructions('obj'), instructions('src')
diff = ''.join(difflib.unified_diff(original, source, fromfile='original', tofile='compiled source'))
print(diff or 'Instruction text matches. Check objdiff relocations/data separately.')
