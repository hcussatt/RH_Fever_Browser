#!/usr/bin/env python3
"""Convert one game's 2D layout (NW4R BRLYT/BRLAN), its textures, the glyphs its font needs and
the game's message text into browser assets (layout.json and layout-*.png), and the layouts that
show its chart's messages (message-layouts.json and message-*.png).

Love Rap draws its lyric captions with one (src/Game/Rap/MyLayout.cpp). Games without a
"layout" entry in their manifest have only message layouts to convert.
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
    if fmt in (0,1,4,5,6):
        tw, th, bs = {0:(8,8,32),1:(8,4,32),4:(4,4,32),5:(4,4,32),6:(4,4,64)}[fmt]
        pixels = np.zeros((h,w,4),np.uint8)
        expand = lambda v, bits: (v*255)//((1<<bits)-1)
        for y in range(h):
            for x in range(w):
                tile = ((y//th)*((w+tw-1)//tw)+x//tw)*bs+start
                j = (y%th)*tw+x%tw
                if fmt == 0:
                    v = ((data[tile+j//2] >> (0 if j%2 else 4))&15)*17
                    rgba = (v,v,v,v)
                elif fmt == 1:
                    v=data[tile+j];rgba=(v,v,v,v)
                elif fmt == 6:
                    a,r = data[tile+j*2:tile+j*2+2];g,b=data[tile+32+j*2:tile+34+j*2];rgba=(r,g,b,a)
                else:
                    v=u16(data,tile+j*2)
                    if fmt == 4:rgba=(expand(v>>11,5),expand((v>>5)&63,6),expand(v&31,5),255)
                    elif v&0x8000:rgba=tuple(((v>>s)&31)*255//31 for s in (10,5,0))+(255,)
                    else:rgba=tuple(((v>>s)&15)*17 for s in (8,4,0))+(((v>>12)&7)*255//7,)
                pixels[y,x]=rgba
        return Image.fromarray(pixels,'RGBA')
    if fmt == 2:  # IA4: 8x4 tiles, alpha in the high nibble.
        px = np.frombuffer(data, np.uint8, w*h, start).reshape(h//4, w//8, 4, 8).transpose(0, 2, 1, 3).reshape(h, w)
        i, a = (px & 15)*17, (px >> 4)*17
    elif fmt == 0:  # I4: 8x8 tiles, two pixels per byte.
        i = a = i4(data, start, w, h)
    elif fmt == 3:  # IA8: 4x4 tiles, alpha then intensity.
        pw, ph = (w+3)//4*4, (h+3)//4*4
        px = np.frombuffer(data, np.uint8, pw*ph*2, start).reshape(ph//4, pw//4, 4, 4, 2).transpose(0, 2, 1, 3, 4).reshape(ph, pw, 2)[:h, :w]
        i, a = px[..., 1], px[..., 0]
    else:
        raise SystemExit(f'Unsupported layout texture format {fmt}')
    return Image.fromarray(np.dstack([i, i, i, a]).astype(np.uint8), 'RGBA')


def i4(data, start, w, h):
    nib = np.frombuffer(data, np.uint8, w*h//2, start)
    px = np.empty(w*h, np.uint8)
    px[0::2], px[1::2] = nib >> 4, nib & 15
    return px.reshape(h//8, w//8, 8, 8).transpose(0, 2, 1, 3).reshape(h, w)*17


def material(b, o):
    """Name, the two TEV colour registers that tint the texture (or glyphs), and its first texture.
    A material with its own TEV stages (the Superb stamp's shining stars) also lists its texture
    maps, texture SRTs and coordinate generators, all three colour registers, the konstant
    colours, the stages, the alpha test and the blend mode, read in nw4r's resource order."""
    cols = struct.unpack_from('>12h', b, o+20)
    flags = u32(b, o+60)
    clamp = lambda v: max(0, min(255, v))
    out = {'name': cstr(b, o, 20), 'color0': [clamp(c) for c in cols[:4]], 'color1': [clamp(c) for c in cols[4:8]],
           'texture': u16(b, o+64) if flags & 15 else None}
    maps, srts, gens = flags & 15, (flags >> 4) & 15, (flags >> 8) & 15
    swap, ind_srts, ind_stages, stages = (flags >> 12) & 1, (flags >> 13) & 3, (flags >> 15) & 7, (flags >> 18) & 31
    alpha_compare, blend, chan, mat_color = (flags >> 23) & 1, (flags >> 24) & 1, (flags >> 25) & 1, (flags >> 27) & 1
    if not stages:
        return out
    if ind_srts or ind_stages:
        raise SystemExit(f'{out["name"]}: indirect texture stages are not supported')
    q = o+64
    out['maps'] = [{'texture': u16(b, q+i*4), 'wrapS': b[q+i*4+2], 'wrapT': b[q+i*4+3]} for i in range(maps)]
    q += maps*4
    out['srts'] = [list(struct.unpack_from('>5f', b, q+i*20)) for i in range(srts)]
    q += srts*20
    out['texCoordGens'] = [list(b[q+i*4:q+i*4+3]) for i in range(gens)]
    q += gens*4
    if chan:
        out['chanCtrl'] = list(b[q:q+2])
        q += 4
    if mat_color:
        out['matColor'] = list(b[q:q+4])
        q += 4
    if swap:
        if b[q:q+4] != bytes.fromhex('e4e4e4e4'):
            raise SystemExit(f'{out["name"]}: TEV swap tables are not supported')
        q += 4
    out['tevColors'] = [[clamp(c) for c in cols[i*4:i*4+4]] for i in range(3)]
    out['kColors'] = [list(b[o+44+i*4:o+48+i*4]) for i in range(4)]
    out['stages'] = []
    for i in range(stages):
        t = b[q+i*16:q+i*16+16]
        # Without indirect stages (checked above) a stage's indirect fields have no effect.
        # Each combiner: a, b, c, d inputs (low nibble first), op/bias/scale, clamp/output/konstant.
        comb = lambda x: {'in': [x[0] & 15, x[0] >> 4, x[1] & 15, x[1] >> 4], 'op': x[2] & 15, 'bias': (x[2] >> 4) & 3,
                          'scale': x[2] >> 6, 'clamp': x[3] & 1, 'out': (x[3] >> 1) & 3, 'konst': x[3] >> 3}
        out['stages'].append({'texCoordGen': t[0], 'channel': t[1], 'map': t[2], 'color': comb(t[4:8]), 'alpha': comb(t[8:12])})
    q += stages*16
    if alpha_compare:
        out['alphaCompare'] = list(b[q:q+4])
        q += 4
    if blend:
        out['blend'] = list(b[q:q+4])
    return out


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
        elif kind in ('pan1', 'pic1', 'txt1', 'wnd1'):
            p = pane(b, pos)
            p['kind'] = {'pan1': 'pane', 'pic1': 'picture', 'txt1': 'text', 'wnd1':'window'}[kind]
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
                text=pos+u32(b,q+12)
                p['text']=b[text:pos+size].decode('utf-16-be').split('\0')[0]
            elif kind == 'wnd1':
                p['inflation']=list(struct.unpack_from('>4f',b,q))
                content=pos+u32(b,q+20)
                p['vertexColors']=[list(b[content+i*4:content+i*4+4]) for i in range(4)]
                p['material']=u16(b,content+16)
                frame_table=pos+u32(b,q+24)
                p['frames']=[{'material':u16(b,pos+u32(b,frame_table+i*4)), 'flip':b[pos+u32(b,frame_table+i*4)+2]} for i in range(b[q+16])]
            last = len(out['panes'])
            out['panes'].append(p)
        elif kind == 'pas1':
            stack.append(last)
        elif kind == 'pae1':
            stack.pop()
    return out


def animation(b):
    """Pane keyframes: RLPA (position 0-2, rotation 3-5, scale 6-7, size 8-9), RLVC (vertex
    colours 0-15, pane alpha 16), RLTP (texture pattern, an index into the timg names), RLTS
    (texture SRT: translate 0-1, rotate 2, scale 3-4) and RLMC (material colour 0-3, colour
    registers 4-15, konstant colours 16-31)."""
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
                    index, target, curve, nkeys, keys = b[a], b[a+1], b[a+2], u16(b, a+4), a+u32(b, a+8)
                    # A texture SRT or register animation names its SRT or register first (index.target).
                    if index:
                        target = f'{index}.{target}'
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


def message_layouts():
    """The layouts whose text boxes show the chart's messages (message panes, web/engine/message.mjs):
    the shared speech balloon and the game's own (each remix scene's), with every message and the
    glyphs they need."""
    games = [GAME]+[s['game'] for s in PROFILE.get('scenes', [])]
    names = ['balloon']+[g for g in games if 'messageLayout' in manifest(g)['wii']]
    out = {'layouts': {}}
    for name in names:
        root = require(DISC/'message-layout'/name)
        file = manifest(name)['wii']['messageLayout']['file'] if name != 'balloon' else 'message.brlyt'
        data = layout((root/'blyt'/file).read_bytes())
        # The layout's own animations (named after it): Hole in One's screen frame,
        # baseball_frm_change_00/01. The balloon's archive holds other layouts' animations only.
        stem = file.rsplit('.', 1)[0]
        data['animations'] = {p.stem: animation(p.read_bytes()) for p in sorted((root/'anim').glob(f'{stem}_*.brlan'))}
        assert not any(a['timg'] for a in data['animations'].values()), f'{name}: message layout animation swaps textures'
        data['images'] = {}
        for n in data['textures']:
            tpl((root/'timg'/n).read_bytes()).save(OUT/f'message-{name}-{n}.png')
            data['images'][n] = f'message-{name}-{n}.png'
        out['layouts'][name] = data
    fonts = {d['fonts'][0] for d in out['layouts'].values()}
    assert len(fonts) == 1, f'Message layouts use different fonts: {fonts}'
    out['messages'] = messages(require(DISC/'message'/'riq_E.bmg').read_bytes())
    chars = {ord(c) for t in out['messages'].values() for c in t if c not in '\n'}
    out['font'], atlas = font(require(DISC/'font'/fonts.pop()).read_bytes(), chars)
    atlas.save(OUT/'message-font.png')
    (OUT/'message-layouts.json').write_text(json.dumps(out, separators=(',', ':'))+'\n')


def main():
    message_layouts()
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
