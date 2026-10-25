"""Shared locations. Everything under build/ and dist/ is generated from the
user's own disc image and must never be committed (see scripts/check-clean.py)."""
import json
import os
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
BUILD = pathlib.Path(os.environ.get('RHF_BUILD', ROOT/'build'))
DIST = pathlib.Path(os.environ.get('RHF_DIST', ROOT/'dist'))
DISC = BUILD/'disc'                 # files read out of the user's ISO
DOL = DISC/'main.dol'
BRSAR = DISC/'rev_tengoku.brsar'
DECOMP = ROOT/'third_party/rhf-decomp'
GAMES = tuple(sorted(p.parent.name for p in (ROOT/'games').glob('*/game.json')))
DOL_SHA1 = 'd96d2c7e50b0c713cb8fcb18835258351ada5576'   # USA SOME01 main.dol


def read_sound_archive(offset, length):
    """Read just the requested sound metadata/sample range.

    The browser replaces this reader with direct decrypted ISO range reads.
    """
    with require(BRSAR).open('rb') as source:
        source.seek(offset)
        data = source.read(length)
    if len(data) != length:
        raise ValueError('Incomplete sound archive')
    return data


def game():
    name = os.environ.get('RHF_GAME', 'golf')
    if name not in GAMES:
        raise SystemExit(f'Unknown game profile {name!r}; known: {", ".join(GAMES)}')
    return name


def manifest(name):
    """games/<name>/game.json: the game's hand-written profile (no game data)."""
    return json.loads((ROOT/'games'/name/'game.json').read_text())


def source(name):
    """Unpacked cellanim archive for one game."""
    return DISC/name


def assets(name):
    out = DIST/name/'assets'
    out.mkdir(parents=True, exist_ok=True)
    return out


def require(path):
    if not pathlib.Path(path).exists():
        raise SystemExit(f'Missing {path}. Run ./build.sh with your ISO first.')
    return path


def menu_icon(name):
    """Original song-select artwork metadata; no image bytes are published."""
    item = manifest(name)
    menu = ROOT/'web/engine/menu.mjs'
    if menu.exists():
        for number, members in re.findall(r"title:'Remix (\d+)',games:\[([^]]+)\]", menu.read_text()):
            names = re.findall(r"'([^']+)'", members)
            if name in names:
                return f'game_{int(number):02d}_{names.index(name)+1}.00.tpl'
    scene = item['wii'].get('scene', '')
    if scene.startswith('Agb'):
        return {'archive': 'EN/content2/cellanim/bonusSelect/agb/cellanim.szs', 'bank': scene[0].lower()+scene[1:]}
    icon = item.get('web', {}).get('icon')
    if not icon:
        raise ValueError(f'{name}: original menu artwork must be registered')
    return icon
