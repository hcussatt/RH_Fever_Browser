#!/usr/bin/env python3
"""Builds the stand-in for the 3DS system font (build/ctr/standin.bcfnt; get-font.sh runs it).

Megamix draws all its text (practice boxes, menus, results) with the console's shared font, which is
not part of the game. This draws a free font (Inter, SIL Open Font License, font/OFL.txt) into a
CFNT with the shared font's layout: 24x30 cells on 128x128 A4 sheets, UTF-16 codes. The 3DS button
symbols the game's messages use (private-use codes U+E000 and up) are drawn here as simple shapes.

Symbols Inter lacks (music notes, gender signs, hearts, stars) come from DejaVu Sans (free license, font/LICENSE-DejaVu.txt).

Usage: make-font.py Inter-SemiBold.otf DejaVuSans-Bold.ttf [out.bcfnt] [--preview]
"""
import struct, sys
from PIL import Image, ImageDraw, ImageFont

CELL_W, CELL_H, BASELINE, SIZE = 24, 30, 23, 23
SHEET_W = SHEET_H = 128
COLS, ROWS = SHEET_W // (CELL_W + 1), SHEET_H // (CELL_H + 1)  # one pixel between cells
# Every character the game's English messages use (USmessage), and the rest of Latin-1.
CHARS = [c for c in range(0x20, 0x7f)] + [c for c in range(0xa0, 0x100)] + [
    0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193,
    0x21d4, 0x2605, 0x2606, 0x2640, 0x2642, 0x2661, 0x2665, 0x266a, 0x266b, 0x3000, 0x30fb]
CHARS += list(range(0xff01, 0xff5f))  # full-width forms: drawn as their ASCII letters
BUTTONS = {0xe000: 'A', 0xe001: 'B', 0xe002: 'X', 0xe003: 'Y', 0xe004: 'L', 0xe005: 'R', 0xe006: '+',
           0xe042: '?', 0xe073: '?', 0xe079: '^', 0xe07a: 'v', 0xe07b: '<', 0xe07c: '>'}
CHARS += list(BUTTONS)


SYMBOLS = {0x21d4, 0x2605, 0x2606, 0x2640, 0x2642, 0x2661, 0x2665, 0x266a, 0x266b}


def draw_char(font, small, code, symbols=None):
    """The glyph's cell (CELL_W x CELL_H, 8-bit alpha), its left bearing, ink width and advance."""
    img = Image.new('L', (CELL_W * 3, CELL_H), 0)
    d = ImageDraw.Draw(img)
    if code in BUTTONS:
        label, x0 = BUTTONS[code], 2
        if label in 'ABXY':
            d.ellipse((x0, 4, x0 + 19, 23), fill=255)
        elif label == '+':  # the +Control Pad
            d.rectangle((x0 + 7, 4, x0 + 12, 23), fill=255); d.rectangle((x0, 11, x0 + 19, 16), fill=255)
            return img.crop((0, 0, CELL_W, CELL_H)), 0, 22, 23
        else:
            d.rounded_rectangle((x0, 6, x0 + 19, 21), 5, fill=255)
        d.text((x0 + 10, 14), label, font=small, fill=0, anchor='mm')
        return img.crop((0, 0, CELL_W, CELL_H)), 0, 22, 23
    ch = chr(code)
    if 0xff01 <= code <= 0xff5e:
        ch = chr(code - 0xfee0)
    if code in (0x3000,):
        ch = ' '
    if code == 0x30fb:
        ch = '·'
    if code in SYMBOLS:
        font = symbols
    ox = CELL_W
    d.text((ox, BASELINE), ch, font=font, fill=255, anchor='ls')
    advance = round(font.getlength(ch))
    box = img.getbbox()
    if not box:  # a space
        return Image.new('L', (CELL_W, CELL_H), 0), 0, 0, advance
    x0, x1 = box[0], box[2]
    if x1 - x0 > CELL_W:  # too wide for a cell: squeeze it
        glyph = img.crop((x0, 0, x1, CELL_H)).resize((CELL_W, CELL_H), Image.LANCZOS)
        return glyph, x0 - ox, CELL_W, advance
    cell = Image.new('L', (CELL_W, CELL_H), 0)
    cell.paste(img.crop((x0, 0, x1, CELL_H)), (0, 0))
    return cell, x0 - ox, x1 - x0, advance


def morton(x, y):
    m = 0
    for b in range(3):
        m |= ((x >> b) & 1) << (2 * b) | ((y >> b) & 1) << (2 * b + 1)
    return m


def encode_a4(sheet):
    """A sheet as the PICA reads an A4 texture: 8x8 tiles in rows from the top, Morton order inside."""
    px = sheet.load()
    out = bytearray(SHEET_W * SHEET_H // 2)
    for ty in range(SHEET_H // 8):
        for tx in range(SHEET_W // 8):
            base = (ty * (SHEET_W // 8) + tx) * 64
            for y in range(8):
                for x in range(8):
                    i = base + morton(x, y)
                    a = px[tx * 8 + x, ty * 8 + y] >> 4
                    out[i >> 1] |= a << (4 * (i & 1))
    return bytes(out)


def main():
    font = ImageFont.truetype(sys.argv[1], SIZE)
    small = ImageFont.truetype(sys.argv[1], 14)
    symbols = ImageFont.truetype(sys.argv[2], SIZE - 2)
    args = [a for a in sys.argv[3:] if not a.startswith('--')]
    out = args[0] if args else 'build/ctr/standin.bcfnt'
    per = COLS * ROWS
    sheets, widths = [], []
    for n, code in enumerate(CHARS):
        if n % per == 0:
            sheets.append(Image.new('L', (SHEET_W, SHEET_H), 0))
        cell, left, gw, adv = draw_char(font, small, code, symbols)
        k = n % per
        sheets[-1].paste(cell, ((k % COLS) * (CELL_W + 1), (k // COLS) * (CELL_H + 1)))
        widths.append((max(-128, min(127, left)), gw, min(255, adv)))
    data = b''.join(encode_a4(s) for s in sheets)
    n = len(CHARS)
    alter = CHARS.index(ord('?'))
    # Blocks: header 0x14, FINF 0x20, TGLP 0x20, CWDH, CMAP (scan), then the sheets (0x80-aligned).
    finf_at, tglp_at = 0x14, 0x34
    cwdh_at = tglp_at + 0x20
    cwdh = struct.pack('<HHI', 0, n - 1, 0) + b''.join(struct.pack('<bBB', *w) for w in widths)
    cwdh += b'\0' * (-len(cwdh) % 4)
    cmap_at = cwdh_at + 8 + len(cwdh)
    pairs = sorted((c, i) for i, c in enumerate(CHARS))
    cmap = struct.pack('<HHHHIH', 0, 0xffff, 2, 0, 0, len(pairs)) + b''.join(struct.pack('<HH', *p) for p in pairs)
    cmap += b'\0' * (-len(cmap) % 4)
    sheet_at = cmap_at + 8 + len(cmap)
    sheet_at += -sheet_at % 0x80
    size = sheet_at + len(data)
    f = bytearray(size)
    struct.pack_into('<4sHHII HH', f, 0, b'CFNT', 0xfeff, 0x14, 0x03000000, size, 4, 0)
    struct.pack_into('<4sIBBHbBBBIIIBBBB', f, finf_at, b'FINF', 0x20, 1, CELL_H, alter, 0, CELL_W, CELL_W, 1,
                     tglp_at + 8, cwdh_at + 8, cmap_at + 8, CELL_H, CELL_W, BASELINE, 0)
    struct.pack_into('<4sIBBBBIHHHHHHI', f, tglp_at, b'TGLP', 0x20, CELL_W, CELL_H, BASELINE, CELL_W,
                     SHEET_W * SHEET_H // 2, len(sheets), 0xb, COLS, ROWS, SHEET_W, SHEET_H, sheet_at)
    struct.pack_into('<4sI', f, cwdh_at, b'CWDH', 8 + len(cwdh)); f[cwdh_at + 8:cwdh_at + 8 + len(cwdh)] = cwdh
    struct.pack_into('<4sI', f, cmap_at, b'CMAP', 8 + len(cmap)); f[cmap_at + 8:cmap_at + 8 + len(cmap)] = cmap
    f[sheet_at:] = data
    open(out, 'wb').write(f)
    print(f'{out}: {n} glyphs on {len(sheets)} sheets, {size} bytes')
    if '--preview' in sys.argv:
        w = Image.new('L', (SHEET_W * len(sheets), SHEET_H))
        for i, s in enumerate(sheets):
            w.paste(s, (i * SHEET_W, 0))
        w.save(out + '.png')


main()
