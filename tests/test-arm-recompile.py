#!/usr/bin/env python3
"""Assemble small ARM routines, translate them with tools/arm_recompile.py, compile the C and
compare the results with the values worked out by hand from the ARM manual's rules.
Needs arm-none-eabi-as/objcopy and a host C compiler."""
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXPECTED = {
    # sum 1..n, squared and bumped through flags, VFP and extends, then a jump table on n.
    'flow': '1234583d 00000018 1f0000\n12345899 00000018 1f0000\nffffffff 00000018 1f0000\nffffffff 0000001b 1f0000\n',
    # loads, stores, write-back, ldm/stm, register offsets, vpush/vpop, flags into adc.
    'memory': 'ff4 ffffbeef ffffff80 4111 44 0 1f0000 7.5\n'
              '44332211efbe8000010203040506070801020304efbe440044332211efbe0000efbeffff80ffffff\n',
}
failed = False
with tempfile.TemporaryDirectory() as tmp:
    tmp = pathlib.Path(tmp)
    for name, expected in EXPECTED.items():
        obj, binary, inc, exe = tmp/f'{name}.o', tmp/f'{name}.bin', tmp/f'{name}.inc', tmp/name
        subprocess.check_call(['arm-none-eabi-as', '-march=armv6k', '-mfpu=vfp', ROOT/f'tests/arm/{name}.s', '-o', obj])
        subprocess.check_call(['arm-none-eabi-objcopy', '-O', 'binary', obj, binary])
        subprocess.check_call([sys.executable, ROOT/'tools/arm_recompile.py', '--binary', binary, '--base', '0x100000',
                               '--entry', '0x100000', '--out', inc], stdout=subprocess.DEVNULL)
        subprocess.check_call(['cc', '-O1', '-w', f'-DARM_H="{ROOT}/adapters/ctr/arm.h"', f'-DTRANSLATED="{inc}"',
                               ROOT/'tests/arm/harness.c', '-o', exe, '-lm'])
        got = subprocess.check_output([exe, name], text=True)
        if got != expected:
            print(f'FAIL {name}:\n  got      {got!r}\n  expected {expected!r}')
            failed = True
        else:
            print(f'ok {name}')
sys.exit(1 if failed else 0)
