#!/usr/bin/env python3
"""Convert this game's original select-menu icon, from the user's ISO only."""
import importlib.util
import struct
from PIL import Image
from pathlib import Path
from paths import DISC, assets, game, manifest, require, menu_icon


def bonus_icon(folder, bank, decode_tpl):
    """Render the first original bonus-menu pose, with its original background.

    This is a lossless PNG of the disc's cell objects, not a replacement illustration.
    """
    data = (folder/(bank+'.brcad')).read_bytes()
    u16 = lambda offset: struct.unpack_from('>H', data, offset)[0]
    if struct.unpack_from('>I', data)[0] != 20100312:
        raise ValueError('Unknown bonus menu bank')
    texture, count, pos = u16(8), u16(16), 20
    cells = []
    for _ in range(count):
        size = u16(pos);pos += 4
        cells.append([struct.unpack_from('>6H2h3f4B', data, pos+i*32) for i in range(size)])
        pos += size*32
    animation_count = u16(pos);pos += 4
    first_cells = []
    for _ in range(animation_count):
        keys = u16(pos);pos += 4
        first_cells.append(u16(pos) if keys else None);pos += keys*24
    tpl = bytearray((folder/'cellanim.tpl').read_bytes())
    table = struct.unpack_from('>I', tpl, 8)[0]
    struct.pack_into('>I', tpl, 8, table+texture*8)
    atlas = decode_tpl(bytes(tpl))
    image = Image.new('RGBA', (320, 320))
    # These banks name animation 0 loop and animation 1 background.
    for cell in first_cells[1:2]+first_cells[:1]:
        if cell is None:
            continue
        for obj in cells[cell]:
            sx, sy, w, h, _, _, x, y, scale_x, scale_y, angle, flip_x, flip_y, alpha, _ = obj
            sprite = atlas.crop((sx, sy, sx+w, sy+h))
            if bool(flip_x) != (scale_x < 0):sprite = sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if bool(flip_y) != (scale_y < 0):sprite = sprite.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            sprite = sprite.resize((max(1, round(w*abs(scale_x))), max(1, round(h*abs(scale_y)))), Image.Resampling.NEAREST)
            if alpha != 255:sprite.putalpha(sprite.getchannel('A').point(lambda a: round(a*alpha/255)))
            sprite = sprite.rotate(-angle, Image.Resampling.NEAREST, expand=True)
            center_x, center_y = x-512+w*scale_x/2+160, y-512+h*scale_y/2+160
            image.alpha_composite(sprite, (round(center_x-sprite.width/2), round(center_y-sprite.height/2)))
    return image


def main():
    icon = menu_icon(game())
    if not icon:
        return
    spec = importlib.util.spec_from_file_location('menu_layout', Path(__file__).with_name('extract-layout.py'))
    layout = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(layout)
    if isinstance(icon, str):
        image = layout.tpl(require(DISC/'menu'/icon).read_bytes())
    else:
        image = bonus_icon(DISC/'menu-banks'/icon['bank'], icon['bank'], layout.tpl)
    image.save(assets(game())/'menu-icon.png')


if __name__ == '__main__':
    main()
