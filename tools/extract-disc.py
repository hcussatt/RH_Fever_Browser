#!/usr/bin/env python3
"""Read the files the port needs out of the user's own Rhythm Heaven Fever ISO.

Usage: extract-disc.py "Rhythm Heaven Fever (USA).iso"
The ISO is opened read-only. Output goes to build/disc/, which is git-ignored.
"""
import hashlib
import json
import sys
from paths import DISC, DOL, BRSAR, DOL_SHA1, GAMES, manifest
from wii_files import WiiFiles, u8_files, yaz0

# Unpacked cellanim archive for each game, from its manifest. A remix unpacks the archive each
# of its scenes loads into a folder named after that scene's game.
CELLANIM = {}
for game in GAMES:
    profile = manifest(game)['wii']
    if 'scenes' in profile:
        CELLANIM.update({f'{game}/{s["game"]}': s['cellanim'] for s in profile['scenes']})
    else:
        CELLANIM[game] = profile['cellanim']
# Epilogue cell animations: beside the game's cellanim archive unless the manifest names one.
EPILOGUE = {game: manifest(game)['wii'].get('epilogue') or manifest(game)['wii']['cellanim'].rsplit('/', 1)[0]+'/cellanim_epilogue.szs'
            for game in GAMES}
# 2D layout archive for games that draw one (Love Rap's lyric captions).
LAYOUT = {game: manifest(game)['wii']['layout'] for game in GAMES if 'layout' in manifest(game)['wii']}
LAYOUT['results'] = {'archive': 'EN/content2/layout/layout_grading.szs', 'file': 'grading.brlyt'}
LAYOUT['epilogue'] = {'archive': 'EN/content2/layout/layout_epilogue.szs', 'file': 'epilogue.brlyt'}
MESSAGES = 'EN/content2/message/riq_E.szs'


def layout_fonts(brlyt):
    """Font file names a layout's fnl1 section lists."""
    pos, names = int.from_bytes(brlyt[12:14], 'big'), []
    while pos < len(brlyt):
        size = int.from_bytes(brlyt[pos+4:pos+8], 'big')
        if brlyt[pos:pos+4] == b'fnl1':
            table = pos+12
            for i in range(int.from_bytes(brlyt[pos+8:pos+10], 'big')):
                start = table+int.from_bytes(brlyt[table+i*8:table+i*8+4], 'big')
                names.append(brlyt[start:brlyt.index(0, start)].decode('ascii'))
        pos += size
    return names


def main(iso, *, sound_archive=True):
    disc = WiiFiles(iso)
    if disc.raw(0, 6) != b'SOME01':
        raise SystemExit(f'Expected Rhythm Heaven Fever USA (SOME01), found {disc.raw(0, 6)!r}')
    DISC.mkdir(parents=True, exist_ok=True)
    dol = disc.dol()
    if hashlib.sha1(dol).hexdigest() != DOL_SHA1:
        raise SystemExit('main.dol does not match the known USA executable; this build expects an unmodified SOME01 disc.')
    DOL.write_bytes(dol)
    report = {'dolSha1': DOL_SHA1, 'files': {}}
    for name,data in u8_files(disc.get('EN/content2/cellanim/permanent/cellanim.szs')).items():
        out=DISC/'permanent'/name
        out.parent.mkdir(parents=True,exist_ok=True)
        out.write_bytes(data)
        report['files'][f'permanent/{name}']=hashlib.sha256(data).hexdigest()
    for game, path in CELLANIM.items():
        for name, data in u8_files(disc.get(path)).items():
            out = DISC/game/name
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            report['files'][f'{game}/{name}'] = hashlib.sha256(data).hexdigest()
    for game, epilogue in EPILOGUE.items():
        for name,data in u8_files(disc.get(epilogue)).items():
            out=DISC/game/'epilogue'/name
            out.parent.mkdir(parents=True,exist_ok=True)
            out.write_bytes(data)
            report['files'][f'{game}/epilogue/{name}']=hashlib.sha256(data).hexdigest()
    for game, layout in LAYOUT.items():
        files = u8_files(disc.get(layout['archive']))
        for name, data in files.items():
            out = DISC/game/'layout'/name
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            report['files'][f'{game}/layout/{name}'] = hashlib.sha256(data).hexdigest()
        # Fonts not in the archive are stand-alone compressed files next to the layouts.
        for font in layout_fonts(files['blyt/'+layout['file']]):
            if 'font/'+font not in files:
                data = yaz0(disc.get('EN/content2/'+font.rsplit('.', 1)[0]+'.szs'))
                (DISC/'font').mkdir(exist_ok=True)
                (DISC/'font'/font).write_bytes(data)
                report['files'][f'font/{font}'] = hashlib.sha256(data).hexdigest()
    if LAYOUT:
        for name, data in u8_files(disc.get(MESSAGES)).items():
            (DISC/'message').mkdir(exist_ok=True)
            (DISC/'message'/name).write_bytes(data)
            report['files'][f'message/{name}'] = hashlib.sha256(data).hexdigest()
    if sound_archive and (not BRSAR.exists() or BRSAR.stat().st_size != disc.files['EN/content2/rev_tengoku.brsar'][1]):
        BRSAR.write_bytes(disc.get('EN/content2/rev_tengoku.brsar'))
    (DISC/'extract-report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(f'Read main.dol, {len(report["files"])} cellanim, layout and message files into {DISC}')
    return disc


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
