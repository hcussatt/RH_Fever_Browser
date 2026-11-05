#!/usr/bin/env python3
"""Prepares your own 3DS system font for the harness: build/ctr/system-font.bcfnt.

Megamix draws all its text with the console's shared font, which is not part of the game. Without it
the harness's text is blank. It takes any of these, from your own console or emulator:
  shared_font.bin          the shared memory block (0x80-byte header, then the font), as Citra or
                           Azahar keep it in their sysdata folder
  cbf_std.bcfnt(.lz)       the font file from system archive 0004009B00014002 (LZ11 or not)
The font's offsets are made relative to the file, as the game expects before it maps the font.

Usage: system-font.py [font file]   (default: $RHF_3DS_FONT, else the first of those names next to
the repository folder or inside it). Without one it says so and leaves the text blank.
"""
import os, struct, sys

OUT = 'build/ctr/system-font.bcfnt'
NAMES = ['shared_font.bin', 'cbf_std.bcfnt', 'cbf_std.bcfnt.lz']
LIMIT = 0x10400000 - 0x10080080  # what fits in the harness's shared memory after the block header


def lz11(d):
    """Decompresses Nintendo's LZ11 (header byte 0x11, 24-bit size)."""
    size = d[1] | d[2] << 8 | d[3] << 16
    i = 4
    if size == 0:
        size = struct.unpack_from('<I', d, 4)[0]; i = 8
    out = bytearray()
    while len(out) < size:
        flags = d[i]; i += 1
        for b in range(8):
            if len(out) >= size:
                break
            if not flags & (0x80 >> b):
                out.append(d[i]); i += 1
                continue
            hi = d[i] >> 4
            if hi == 0:
                n = ((d[i] & 15) << 4 | d[i + 1] >> 4) + 0x11; disp = ((d[i + 1] & 15) << 8 | d[i + 2]) + 1; i += 3
            elif hi == 1:
                n = ((d[i] & 15) << 12 | d[i + 1] << 4 | d[i + 2] >> 4) + 0x111; disp = ((d[i + 2] & 15) << 8 | d[i + 3]) + 1; i += 4
            else:
                n = hi + 1; disp = ((d[i] & 15) << 8 | d[i + 1]) + 1; i += 2
            for _ in range(n):
                out.append(out[-disp])
    return bytes(out)


def normalize(d):
    if d[:1] == b'\x11' and d[:4] != b'CFNT':
        d = lz11(d)
    if d[:4] != b'CFNT' and d[0x80:0x84] == b'CFNT':
        d = d[0x80:]
    if d[:4] != b'CFNT':
        raise SystemExit('not a 3DS font (no CFNT header)')
    f = bytearray(d)
    u32 = lambda o: struct.unpack_from('<I', f, o)[0]
    put = lambda o, v: struct.pack_into('<I', f, o, v)
    finf = struct.unpack_from('<H', f, 6)[0]
    tglp = f.find(b'TGLP')
    delta = u32(finf + 16) - (tglp + 8)  # where the font's pointers think it starts
    if delta:
        for o in (finf + 16, finf + 20, finf + 24):  # TGLP, CWDH, CMAP
            put(o, u32(o) - delta)
        put(tglp + 28, u32(tglp + 28) - delta)  # sheet data
        for first, link in ((finf + 20, 4), (finf + 24, 8)):  # CWDH and CMAP chains
            o = first
            while u32(o):
                at = u32(o)
                nxt = at + link
                if u32(nxt):
                    put(nxt, u32(nxt) - delta)
                o = nxt
    return bytes(f)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('RHF_3DS_FONT')
    if not src:
        src = next((p for d in ('..', '.') for n in NAMES for p in [os.path.join(d, n)] if os.path.isfile(p)), None)
    if not src:
        print('No 3DS system font found (shared_font.bin or cbf_std.bcfnt next to the repository folder); '
              'game text will be blank.')
        return
    font = normalize(open(src, 'rb').read())
    if len(font) > LIMIT:
        raise SystemExit(f'{src}: font too large ({len(font)} bytes)')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'wb').write(font)
    print(f'{OUT}: from {src}, {len(font)} bytes')


main()
