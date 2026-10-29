#!/usr/bin/env python3
"""Read the program and file list the port needs out of the user's own decrypted
Rhythm Heaven Megamix (USA) dump.

Usage: extract-3ds.py "Rhythm Heaven Megamix (USA).cia" [RomFS path pattern ...]
(a decrypted .cia, .3ds, .cci or .cxi). The dump is opened read-only. Output goes to build/ctr/,
which is git-ignored: code-text.bin, code-rodata.bin, code-data.bin, code.json (load addresses and
sizes), romfs.json (every RomFS file's path, offset and size, so later steps read single files),
romfs-meta.bin (the RomFS header and directory tables the program reads before any file) and,
for each pattern given (fnmatch, such as 'cellanim/ctrBlanco*'), the matching files under romfs/.
"""
import fnmatch
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
(CTR/'romfs-meta.bin').write_bytes(dump.raw(dump.level3, dump.level3_data))
(CTR/'romfs.json').write_text(json.dumps({'dump': str(sys.argv[1]), 'level3': dump.level3,
                                          'level3_data': dump.level3_data, 'files': dump.files}, indent=0))
wanted = [name for name in dump.files if any(fnmatch.fnmatch(name, p) for p in sys.argv[2:])]
for name in wanted:
    out = CTR/'romfs'/name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(dump.read(name))
print(f'code: text {info["text"]["size"]:#x} at {info["text"]["address"]:#x}, rodata {info["rodata"]["size"]:#x}, '
      f'data {info["data"]["size"]:#x}; RomFS: {len(dump.files)} files, {len(wanted)} extracted')
