"""Shared locations. Everything under build/ and dist/ is generated from the
user's own disc image and must never be committed (see scripts/check-clean.py)."""
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
BUILD = pathlib.Path(os.environ.get('RHF_BUILD', ROOT/'build'))
DIST = pathlib.Path(os.environ.get('RHF_DIST', ROOT/'dist'))
DISC = BUILD/'disc'                 # files read out of the user's ISO
DOL = DISC/'main.dol'
BRSAR = DISC/'rev_tengoku.brsar'
DECOMP = ROOT/'third_party/rhf-decomp'
GAMES = ('golf', 'tap')
DOL_SHA1 = 'd96d2c7e50b0c713cb8fcb18835258351ada5576'   # USA SOME01 main.dol


def game():
    name = os.environ.get('RHF_GAME', 'golf')
    if name not in GAMES:
        raise SystemExit(f'Unknown game profile {name!r}; known: {", ".join(GAMES)}')
    return name


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
