#!/usr/bin/env python3
"""Extract original data sections for the precompiled runtime (no compiler needed)."""
import json
import struct
from paths import DOL, assets, game, require

blob = require(DOL).read_bytes()
u32 = lambda o: struct.unpack_from('>I', blob, o)[0]
segments = []
for i in range(18):
    off, address, size = u32(i*4), u32(0x48+i*4), u32(0x90+i*4)
    if size and address >= 0x801f0000:
        name = f'data-{address:08x}.bin'
        (assets(game())/name).write_bytes(blob[off:off+size])
        segments.append({'address': address, 'file': name, 'size': size})
(assets(game())/'original-segments.json').write_text(json.dumps(segments)+'\n')
