#!/usr/bin/env python3
"""Convert this game's original select-menu icon, from the user's ISO only."""
import importlib.util
from pathlib import Path
from paths import DISC, assets, game, manifest, require


def main():
    icon = manifest(game()).get('web', {}).get('icon')
    if not icon:
        return
    spec = importlib.util.spec_from_file_location('menu_layout', Path(__file__).with_name('extract-layout.py'))
    layout = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(layout)
    layout.tpl(require(DISC/'menu'/icon).read_bytes()).save(assets(game())/'menu-icon.png')


if __name__ == '__main__':
    main()
