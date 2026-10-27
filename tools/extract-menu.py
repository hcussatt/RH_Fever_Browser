#!/usr/bin/env python3
"""Convert this game's original select-menu icon and description, from the user's ISO only.

A game the original song select has no icon for (the GBA games, Night Walk) gets one drawn from
its own converted sprites (web.iconArt in game.json): one cell of a cell animation, cropped and
fitted over a colour the game itself uses, inside the frame of an original icon."""
import importlib.util
import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image
from paths import DISC, assets, game, manifest, require

# The original icon whose rounded black frame the drawn icons reuse (Hole in One's).
FRAME_ICON = 'game_01_1.00.tpl'
BEVEL = 4


def layout():
    spec = importlib.util.spec_from_file_location('menu_layout', Path(__file__).with_name('extract-layout.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def trs(x, y, deg, sx, sy):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [c*sx, s*sx, -s*sy, c*sy, x, y]


def mul(a, b):
    return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
            a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]


def cell_image(out, art, size=1024):
    """One cell drawn the way web/engine/renderer.mjs draws it, cropped to its pixels."""
    data = json.loads(require(out/'original-assets.json').read_text())
    bank = data['banks'][art['bank']]
    texture = Image.open(require(out/data['textures'][bank['texture']])).convert('RGBA')
    if 'animation' in art:
        key = bank['animations'][bank['labels'][art['animation']]][art.get('key', 0)]
        cell, m = key['cell'], trs(key['x'], key['y'], key['angle'], key['scaleX'], key['scaleY'])
    else:
        cell, m = art['cell'], trs(0, 0, 0, 1, 1)
    m = mul([1, 0, 0, 1, size/2, size/2], m)
    canvas = Image.new('RGBA', (size, size))
    for o in bank['cells'][cell]:
        part = texture.crop((o['sx'], o['sy'], o['sx']+o['w'], o['sy']+o['h']))
        if o['alpha'] < 255:
            part.putalpha(part.getchannel('A').point(lambda v: v*o['alpha']//255))
        om = mul(m, trs(o['x']+o['w']*o['scaleX']/2, o['y']+o['h']*o['scaleY']/2, o['angle'],
                        o['scaleX']*(-1 if o['flipX'] else 1), o['scaleY']*(-1 if o['flipY'] else 1)))
        a, b, c, d, e, f = mul(om, [1, 0, 0, 1, -o['w']/2, -o['h']/2])
        det = a*d-b*c
        inverse = [d/det, -c/det, (c*f-d*e)/det, -b/det, a/det, (b*e-a*f)/det]
        canvas.alpha_composite(part.transform((size, size), Image.AFFINE, inverse, resample=Image.NEAREST))
    canvas = canvas.crop(canvas.getbbox())
    if 'crop' in art:
        # Fractions of the cell's own bounds: left, top, right, bottom.
        l, t, r, b = art['crop']
        canvas = canvas.crop((round(l*canvas.width), round(t*canvas.height), round(r*canvas.width), round(b*canvas.height)))
    return canvas


def background(out, art):
    colour = art['background']
    if 'texture' in colour:
        image = Image.open(require(out/colour['texture'])).convert('RGB')
        return image.getpixel(tuple(colour['pixel']))
    return tuple(colour['color'])


def drawn_icon(out, art, frame_icon):
    """The frame is the original icon's outline with a black ring as thick as its own."""
    frame = np.array(frame_icon.convert('RGBA'))
    size = frame.shape[0]
    # The ring's thickness: the dark run from the left edge along the middle row.
    row = frame[size//2]
    border = next(x for x in range(size) if row[x, 3] == 255 and row[x, :3].max() > 60)
    # Distance from each pixel centre to the nearest pixel outside the outline (the margin counts).
    outside = np.argwhere(np.pad(frame[..., 3] == 0, 1, constant_values=True))-1
    ys, xs = np.mgrid[0:size, 0:size]
    squared = (ys[..., None]-outside[:, 0])**2+(xs[..., None]-outside[:, 1])**2
    distance = np.sqrt(squared.min(-1))
    nearest = outside[squared.argmin(-1)]
    inside = np.clip(distance-border-.5, 0, 1)[..., None]
    sprite = cell_image(out, art)
    box = size-2*border-2*art.get('padding', 2)
    scale = min(box/sprite.width, box/sprite.height)*art.get('scale', 1)
    sprite = sprite.resize((max(1, round(sprite.width*scale)), max(1, round(sprite.height*scale))), Image.LANCZOS)
    picture = Image.new('RGBA', (size, size), background(out, art)+(255,))
    dx, dy = art.get('offset', [0, 0])
    x = (size-sprite.width)//2+dx
    y = (size-border-sprite.height if art.get('align') == 'bottom' else (size-sprite.height)//2)+dy
    picture.alpha_composite(sprite, (x, y))
    icon = np.array(picture).astype(float)
    # The bevel the original icons have inside the ring: a light band along the top and left
    # edges and a dark band along the bottom and right, fading out over BEVEL pixels.
    edge = np.clip(1-(distance-border-.5)/BEVEL, 0, 1)
    facing = ((ys-nearest[..., 0])+(xs-nearest[..., 1]))/np.maximum(distance, 1)
    light = (edge*np.clip(facing, 0, 1)*.45)[..., None]
    dark = (edge*np.clip(-facing, 0, 1)*.3)[..., None]
    icon[..., :3] = icon[..., :3]*(1-light)+255*light
    icon[..., :3] *= 1-dark
    icon[..., :3] *= inside
    icon[..., 3] = frame[..., 3]
    return Image.fromarray(icon.round().astype(np.uint8))


def description(title, text):
    """The song select's description of a game (riq_title_E.bmg): a title message's id plus 1000
    holds its description. Game titles first (1000s), then the rhythm toys and extra games (3000s)."""
    ids = sorted((i for i, t in text.items() if t == title and (1000 <= i < 2000 or 3000 <= i < 4000)),
                 key=lambda i: (i >= 3000, i))
    found = next((text[i+1000] for i in ids if i+1000 in text), None)
    # Lines are broken for the original's box; the menu wraps the text itself. Tags are dropped.
    return ' '.join(re.sub(r'\{[0-9a-f]*\}', '', found).split()) if found else None


# Title-screen panes left out behind the menu: the game's name (logo, rogo, title pictures and their
# shadows) and the remix screens' letters.
TITLE_TEXT = re.compile(r'logo|rogo|title', re.I)
REMIX_LETTERS = re.compile(r'^RM_(ri|mi|tsu|ku|su|N)_\d+\.tpl$')


def title_screen(out, folder):
    """The game's title screen (its prologue layout) as a layout the menu draws at the end of its
    animation, with the title text hidden."""
    module = layout()
    data = module.layout((folder/'blyt/prologue.brlyt').read_bytes())
    data['animations'] = {p.stem: module.animation(p.read_bytes()) for p in sorted((folder/'anim').glob('*.brlan'))}
    data['images'] = {}
    for p in sorted((folder/'timg').glob('*.tpl')):
        name = 'prologue-'+p.name+'.png'
        module.tpl(p.read_bytes()).save(out/name)
        data['images'][p.name] = name
    texture = lambda pane: data['textures'][data['materials'][pane['material']]['texture']] \
        if pane.get('material') is not None and data['materials'][pane['material']].get('texture') is not None else ''
    data['hidden'] = [p['name'] for p in data['panes']
                      if TITLE_TEXT.search(p['name']) or TITLE_TEXT.search(texture(p)) or REMIX_LETTERS.match(texture(p))]
    (out/'prologue-layout.json').write_text(json.dumps(data, separators=(',', ':'))+'\n')


def title_logo(out, folder):
    """The game's logo from its title screen (the N_logo_all_00 group of layout_title), drawn by the
    menu at the end of the logo's opening animation. Only the logo's textures are kept."""
    module = layout()
    data = module.layout((folder/'blyt/title.brlyt').read_bytes())
    data['animations'] = {'title_logo_open': module.animation((folder/'anim/title_logo_open.brlan').read_bytes())}
    panes = data['panes']
    logo = next(i for i, p in enumerate(panes) if p['name'] == 'N_logo_all_00')

    def in_logo(i):
        while i is not None:
            if i == logo:
                return True
            i = panes[i].get('parent')
        return False
    texture = lambda p: data['textures'][data['materials'][p['material']]['texture']] \
        if p.get('material') is not None and data['materials'][p['material']].get('texture') is not None else None
    data['hidden'] = [p['name'] for i, p in enumerate(panes) if i and not in_logo(i) and p.get('material') is not None]
    used = {texture(p) for i, p in enumerate(panes) if in_logo(i)} - {None}
    data['images'] = {}
    for name in sorted(used):
        module.tpl((folder/'timg'/name).read_bytes()).save(out/('title-'+name+'.png'))
        data['images'][name] = 'title-'+name+'.png'
    (out/'title-layout.json').write_text(json.dumps(data, separators=(',', ':'))+'\n')


def main():
    profile = manifest(game())
    web = profile.get('web', {})
    out = assets(game())
    module = layout()
    text = module.messages(require(DISC/'message'/'riq_title_E.bmg').read_bytes())
    if (DISC/'title').exists():
        title_logo(out, DISC/'title')
    if (DISC/game()/'prologue').exists():
        title_screen(out, DISC/game()/'prologue')
    (out/'menu.json').write_text(json.dumps({'description': description(profile['title'], text) or web.get('description')}, ensure_ascii=False)+'\n')
    if web.get('icon'):
        out_icon = module.tpl(require(DISC/'menu'/web['icon']).read_bytes())
    elif web.get('iconArt'):
        out_icon = drawn_icon(out, web['iconArt'], module.tpl(require(DISC/'menu'/FRAME_ICON).read_bytes()))
    else:
        return
    out_icon.save(out/'menu-icon.png')


if __name__ == '__main__':
    main()
