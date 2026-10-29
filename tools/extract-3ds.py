#!/usr/bin/env python3
"""Read the program and file list the port needs out of the user's own decrypted
Rhythm Heaven Megamix (USA) dump.

Usage: extract-3ds.py "Rhythm Heaven Megamix (USA).cia"   (a decrypted .cia, .3ds or .cci)
The dump is opened read-only. Output goes to build/ctr/, which is git-ignored:
code-text.bin, code-rodata.bin, code-data.bin, code.json (load addresses and sizes) and
romfs.json (every RomFS file's path, offset and size, so later steps read single files).
"""
import json
import sys
from paths import CTR
from ctr_files import CtrFiles, MEGAMIX_USA

dump = CtrFiles(sys.argv[1])
if dump.title != MEGAMIX_USA:
    raise SystemExit(f'Expected Rhythm Heaven Megamix (USA, {MEGAMIX_USA:016X}), got {dump.title:016X}')
CTR.mkdir(parents=True, exist_ok=True)
segments = dump.code()
info = {'bss': segments.pop('bss')}
for name, (address, data) in segments.items():
    (CTR/f'code-{name}.bin').write_bytes(data)
    info[name] = {'address': address, 'size': len(data)}
(CTR/'code.json').write_text(json.dumps(info, indent=1))
(CTR/'romfs.json').write_text(json.dumps({'dump': str(sys.argv[1]), 'files': dump.files}, indent=0))
print(f'code: text {info["text"]["size"]:#x} at {info["text"]["address"]:#x}, rodata {info["rodata"]["size"]:#x}, '
      f'data {info["data"]["size"]:#x}; RomFS: {len(dump.files)} files')
