#!/usr/bin/env python3
"""Convert one game's 2D layout (NW4R BRLYT/BRLAN), its textures, the glyphs its font needs and
the game's message text into browser assets (layout.json and layout-*.png).

Love Rap draws its lyric captions with one (src/Game/Rap/MyLayout.cpp). Games without a
"layout" entry in their manifest have nothing to convert.
"""
import json
import struct
import numpy as np
from PIL import Image

from paths import DISC, assets, game, manifest, require

GAME = game()
PROFILE = manifest(GAME)['wii']
OUT = assets(GAME)
u8 = lambda b, o: b[o]
u16 = lambda b, o: struct.unpack_from('>H', b, o)[0]
u32 = lambda b, o: struct.unpack_from('>I', b, o)[0]
f32 = lambda b, o: struct.unpack_from('>f', b, o)[0]
cstr = lambda b, o, n=None: b[o:(o+n if n else b.index(0, o))].split(b'\0')[0].decode('ascii')


def sections(b):
    pos = u16(b, 12)
    while pos < len(b):
        yield b[pos:pos+4].decode('ascii'), pos, u32(b, pos+4)
        pos += u32(b, pos+4)


def name_table(b, pos):
    """txl1/fnl1: a count, then (offset, 0) pairs relative to the table start, then names."""
    return [cstr(b, pos+12+u32(b, pos+12+i*8)) for i in range(u16(b, pos+8))]


def tpl(data):
    """Intensity and alpha of a one-image TPL as an RGBA image (I in the colour channels):
    the material's colours are applied in the browser, like the original's TEV setup."""
    header = u32(data, u32(data, 8))
    h, w, fmt, start = struct.unpack_from('>HHII', data, header)
    if fmt == 2:  # IA4: 8x4 tiles, alpha in the high nibble.
        px = np.frombuffer(data, np.uint8, w*h, start).reshape(h//4, w//8, 4, 8).transpose(0, 2, 1, 3).reshape(h, w)
        i, a = (px & 15)*17, (px >> 4)*17
    elif fmt == 0:  # I4: 8x8 tiles, two pixels per byte.
        i = a = i4(data, start, w, h)
    else:
        raise SystemExit(f'Unsupported layout texture format {fmt}')
    return Image.fromarray(np.dstack([i, i, i, a]).astype(np.uint8), 'RGBA')


def i4(data, start, w, h):
    nib = np.frombuffer(data, np.uint8, w*h//2, start)
    px = np.empty(w*h, np.uint8)
    px[0::2], px[1::2] = nib >> 4, nib & 15
    return px.reshape(h//8, w//8, 8, 8).transpose(0, 2, 1, 3).reshape(h, w)*17


def material(b, o):
    """Name, the two TEV colour registers that tint the texture (or glyphs), and its first texture."""
    cols = struct.unpack_from('>8h', b, o+20)
    flags = u32(b, o+60)
    clamp = lambda v: max(0, min(255, v))
    return {'name': cstr(b, o, 20), 'color0': [clamp(c) for c in cols[:4]], 'color1': [clamp(c) for c in cols[4:8]],
            'texture': u16(b, o+64) if flags & 15 else None}


def pane(b, o):
    flags, origin, alpha = b[o+8], b[o+9], b[o+10]
    return {'name': cstr(b, o+12, 16), 'visible': bool(flags & 1), 'influencedAlpha': bool(flags & 2),
            'locationAdjust': bool(flags & 4),
            'origin': origin, 'alpha': alpha, 'translate': list(struct.unpack_from('>2f', b, o+0x24)),
            'rotate': f32(b, o+0x38), 'scale': list(struct.unpack_from('>2f', b, o+0x3c)),
            'size': list(struct.unpack_from('>2f', b, o+0x44))}


def layout(b):
    out = {'panes': [], 'materials': []}
    stack, last = [], None
    for kind, pos, size in sections(b):
        if kind == 'lyt1':
            out['size'] = list(struct.unpack_from('>2f', b, pos+12))
        elif kind == 'txl1':
            out['textures'] = name_table(b, pos)
        elif kind == 'fnl1':
            out['fonts'] = name_table(b, pos)
        elif kind == 'mat1':
            n = u16(b, pos+8)
            out['materials'] = [material(b, pos+u32(b, pos+12+i*4)) for i in range(n)]
        elif kind in ('pan1', 'pic1', 'txt1'):
            p = pane(b, pos)
            p['kind'] = {'pan1': 'pane', 'pic1': 'picture', 'txt1': 'text'}[kind]
            p['parent'] = stack[-1] if stack else None
            q = pos+0x4c
            if kind == 'pic1':
                p['vertexColors'] = [list(b[q+i*4:q+i*4+4]) for i in range(4)]
                p['material'], ncoords = u16(b, q+16), b[q+18]
                p['texcoords'] = [list(struct.unpack_from('>2f', b, q+20+i*8)) for i in range(4)] if ncoords else None
            elif kind == 'txt1':
                p['material'], p['font'] = u16(b, q+4), u16(b, q+6)
                p['textPosition'], p['alignment'] = b[q+8], b[q+9]
                p['colors'] = [list(b[q+16:q+20]), list(b[q+20:q+24])]
                p['fontSize'] = list(struct.unpack_from('>2f', b, q+24))
                p['charSpace'], p['lineSpace'] = struct.unpack_from('>2f', b, q+32)
            last = len(out['panes'])
            out['panes'].append(p)
        elif kind == 'pas1':
            stack.append(last)
        elif kind == 'pae1':
            stack.pop()
    return out


def animation(b):
    """Pane keyframes: RLPA (position 0-2, rotation 3-5, scale 6-7, size 8-9), RLVC (vertex
    colours 0-15, pane alpha 16), RLTP (texture pattern, an index into the timg names)."""
    out = {}
    for kind, pos, size in sections(b):
        if kind != 'pai1':
            continue
        out['frames'], out['loop'] = u16(b, pos+8), bool(b[pos+10])
        ntimg, nentries, entries = u16(b, pos+12), u16(b, pos+14), pos+u32(b, pos+16)
        out['timg'] = [cstr(b, pos+20+u32(b, pos+20+i*4)) for i in range(ntimg)]
        out['panes'] = {}
        for i in range(nentries):
            e = pos+u32(b, entries+i*4)
            tags = out['panes'].setdefault(cstr(b, e, 20), {})
            for t in range(b[e+20]):
                tag = e+u32(b, e+24+t*4)
                for k in range(b[tag+4]):
                    a = tag+u32(b, tag+8+k*4)
                    target, curve, nkeys, keys = b[a+1], b[a+2], u16(b, a+4), a+u32(b, a+8)
                    # Hermite keys are (frame, value, slope); step keys are (frame, value).
                    tags.setdefault(cstr(b, tag, 4), {})[target] = [list(struct.unpack_from('>3f', b, keys+j*12)) for j in range(nkeys)] if curve == 2 else \
                        [[f32(b, keys+j*8), u16(b, keys+j*8+4)] for j in range(nkeys)]
    return out


def messages(b):
    """BMG id -> text (CBMGRes): UTF-16 strings; 0x1A tags are kept as {hex}."""
    blocks, pos = {}, 0x20
    for _ in range(u32(b, 12)):
        blocks[b[pos:pos+4]] = pos
        pos += u32(b, pos+4)
    inf, dat, mid = blocks[b'INF1'], blocks[b'DAT1'], blocks[b'MID1']
    out = {}
    for i in range(u16(b, inf+8)):
        j, text = dat+8+u32(b, inf+16+i*u16(b, inf+10)), []
        while (c := u16(b, j)):
            if c == 0x1a:
                text.append('{'+b[j+3:j+b[j+2]].hex()+'}')
                j += b[j+2]
            else:
                text.append(chr(c))
                j += 2
        out[u32(b, mid+16+i*4)] = ''.join(text)
    return out


def font(b, chars):
    """The glyphs for the given characters, packed into one atlas, with their widths."""
    finf = u16(b, 12)
    line_feed, alt = b[finf+9], u16(b, finf+10)
    tglp, cwdh, cmap = u32(b, finf+16)-8, u32(b, finf+20)-8, u32(b, finf+24)-8
    height, width, ascent = b[finf+28], b[finf+29], b[finf+30]
    cw, ch, _, _, sheet_size, _, fmt, rows, lines, sw, sh, image = struct.unpack_from('>BBBBIHHHHHHI', b, tglp+8)
    assert fmt == 0, f'Unsupported font sheet format {fmt}'
    index = {}
    while cmap > 0:
        begin, end, method = u16(b, cmap+8), u16(b, cmap+10), u16(b, cmap+12)
        data = cmap+20
        if method == 0:
            for c in range(begin, end+1):
                index[c] = u16(b, data)+c-begin
        elif method == 1:
            for c in range(begin, end+1):
                if u16(b, data+(c-begin)*2) != 0xffff:
                    index[c] = u16(b, data+(c-begin)*2)
        else:
            for k in range(u16(b, data)):
                index[u16(b, data+2+k*4)] = u16(b, data+4+k*4)
        cmap = u32(b, cmap+16)-8 if u32(b, cmap+16) else 0
    widths = {}
    while cwdh > 0:
        first, last = u16(b, cwdh+8), u16(b, cwdh+10)
        for g in range(first, last+1):
            widths[g] = struct.unpack_from('>bBb', b, cwdh+16+(g-first)*3)
        cwdh = u32(b, cwdh+12)-8 if u32(b, cwdh+12) else 0
    per_sheet = rows*lines
    glyphs, cells = {}, []
    for c in sorted(chars):
        g = index.get(c, alt)
        sheet, cell = divmod(g, per_sheet)
        y, x = divmod(cell, rows)
        cells.append((sheet, x*(cw+1), y*(ch+1)))
        left, glyph_width, char_width = widths.get(g, struct.unpack_from('>bBb', b, finf+12))
        glyphs[c] = {'cell': len(cells)-1, 'left': left, 'glyphWidth': glyph_width, 'charWidth': char_width}
    columns = 16
    atlas = np.zeros((((len(cells)+columns-1)//columns)*ch, columns*cw), np.uint8)
    sheets = {}
    for k, (sheet, x, y) in enumerate(cells):
        if sheet not in sheets:
            sheets[sheet] = i4(b, image+sheet*sheet_size, sw, sh)
        r, c = divmod(k, columns)
        atlas[r*ch:(r+1)*ch, c*cw:(c+1)*cw] = sheets[sheet][y:y+ch, x:x+cw]
    return {'height': height, 'width': width, 'ascent': ascent, 'lineFeed': line_feed, 'cellWidth': cw,
            'cellHeight': ch, 'columns': columns, 'glyphs': glyphs}, Image.fromarray(np.dstack([atlas]*4), 'RGBA')


def main():
    entry = PROFILE.get('layout')
    if not entry:
        return
    root = require(DISC/GAME/'layout')
    out = layout((root/'blyt'/entry['file']).read_bytes())
    out['animations'] = {p.stem: animation(p.read_bytes()) for p in sorted((root/'anim').glob('*.brlan'))}
    names = set(out['textures'])|{n for a in out['animations'].values() for n in a['timg']}
    for n in names:
        tpl((root/'timg'/n).read_bytes()).save(OUT/f'layout-{n}.png')
    out['images'] = {n: f'layout-{n}.png' for n in sorted(names)}
    out['messages'] = messages(require(DISC/'message'/'riq_E.bmg').read_bytes())
    chars = {ord(c) for t in out['messages'].values() for c in t if c not in '\n'}
    out['font'], atlas = font(require(DISC/'font'/out['fonts'][0]).read_bytes(), chars)
    atlas.save(OUT/'layout-font.png')
    (OUT/'layout.json').write_text(json.dumps(out, separators=(',', ':'))+'\n')
    print(json.dumps({'panes': len(out['panes']), 'animations': list(out['animations']), 'images': len(names),
                      'messages': len(out['messages']), 'glyphs': len(chars)}))


if __name__ == '__main__':
    main()
