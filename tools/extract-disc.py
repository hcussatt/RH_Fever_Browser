#!/usr/bin/env python3
"""Read the files the port needs out of the user's own Rhythm Heaven Fever ISO.

Usage: extract-disc.py "Rhythm Heaven Fever (USA).iso"
The ISO is opened read-only. Output goes to build/disc/, which is git-ignored.
"""
import hashlib
import json
import sys
from paths import DISC, DOL, BRSAR, DOL_SHA1, GAMES, manifest
from wii_files import WiiFiles, u8_files

# Unpacked cellanim archive for each game, from its manifest.
CELLANIM = {game: manifest(game)['wii']['cellanim'] for game in GAMES}


def main(iso):
    disc = WiiFiles(iso)
    if disc.raw(0, 6) != b'SOME01':
        raise SystemExit(f'Expected Rhythm Heaven Fever USA (SOME01), found {disc.raw(0, 6)!r}')
    DISC.mkdir(parents=True, exist_ok=True)
    dol = disc.dol()
    if hashlib.sha1(dol).hexdigest() != DOL_SHA1:
        raise SystemExit('main.dol does not match the known USA executable; this build expects an unmodified SOME01 disc.')
    DOL.write_bytes(dol)
    report = {'dolSha1': DOL_SHA1, 'files': {}}
    for game, path in CELLANIM.items():
        for name, data in u8_files(disc.get(path)).items():
            out = DISC/game/name
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            report['files'][f'{game}/{name}'] = hashlib.sha256(data).hexdigest()
    if not BRSAR.exists() or BRSAR.stat().st_size != disc.files['EN/content2/rev_tengoku.brsar'][1]:
        BRSAR.write_bytes(disc.get('EN/content2/rev_tengoku.brsar'))
    (DISC/'extract-report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(f'Read main.dol, {len(report["files"])} cellanim files and the sound archive into {DISC}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
