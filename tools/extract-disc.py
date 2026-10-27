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
        # Another game's archive a scene also loads (the navigator's metronome) goes in a folder
        # inside the scene's, named after that game's cellanim folder.
        CELLANIM.update({f'{game}/{s["game"]}/{path.split("/")[-3]}': path for s in profile['scenes']
                         for path in manifest(s['game'])['wii'].get('extraCellanims', [])})
    else:
        CELLANIM[game] = profile['cellanim']
        CELLANIM.update({f'{game}/{path.split("/")[-3]}': path for path in profile.get('extraCellanims', [])})
# Epilogue cell animations: beside the game's cellanim archive unless the manifest names one. A
# scene only a remix changes to, and a game with no results (Night Walk), have none.
EPILOGUE = {game: manifest(game)['wii'].get('epilogue') or manifest(game)['wii']['cellanim'].rsplit('/', 1)[0]+'/cellanim_epilogue.szs'
            for game in GAMES if not manifest(game)['wii'].get('sceneOnly') and manifest(game)['wii'].get('results', True)}
# 2D layout archive for games that draw one (Love Rap's lyric captions).
LAYOUT = {game: manifest(game)['wii']['layout'] for game in GAMES if 'layout' in manifest(game)['wii']}
# A lyric layout beside a game's own (Night Walk's song title card over its sky).
LYRIC_LAYOUT = {game: manifest(game)['wii']['lyricLayout'] for game in GAMES if 'lyricLayout' in manifest(game)['wii']}
LAYOUT['results'] = {'archive': 'EN/content2/layout/layout_grading.szs', 'file': 'grading.brlyt'}
LAYOUT['epilogue'] = {'archive': 'EN/content2/layout/layout_epilogue.szs', 'file': 'epilogue.brlyt'}
# Layouts whose text boxes show the charts' messages: the shared speech balloon (CBalloonLayout,
# message.brlyt) and a game's own (Hole in One's), including those of a remix's scenes.
MESSAGE_LAYOUTS = {'balloon': {'archive': 'EN/content2/layout/layout_common.szs', 'file': 'message.brlyt'}}
for game in GAMES:
    profile = manifest(game)['wii']
    for name in [game]+[s['game'] for s in profile.get('scenes', [])]:
        if 'messageLayout' in manifest(name)['wii']:
            MESSAGE_LAYOUTS[name] = manifest(name)['wii']['messageLayout']
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
    icons = {manifest(game).get('web', {}).get('icon') for game in GAMES} - {None}
    if icons:
        menu = u8_files(disc.get('EN/content2/layout/layout_gameSelect.szs'))
        (DISC/'menu').mkdir(exist_ok=True)
        for icon in sorted(icons):
            data = menu['timg/'+icon]
            (DISC/'menu'/icon).write_bytes(data)
            report['files']['menu/'+icon] = hashlib.sha256(data).hexdigest()

    for name,data in u8_files(disc.get('EN/content2/cellanim/permanent/cellanim.szs')).items():
        out=DISC/'permanent'/name
        out.parent.mkdir(parents=True,exist_ok=True)
        out.write_bytes(data)
        report['files'][f'permanent/{name}']=hashlib.sha256(data).hexdigest()
    # Remix 8's photo frame (CExFlow 0x13f loads it by this fixed path).
    for name,data in u8_files(disc.get('EN/content2/cellanim/remix/ver8/cellanim.szs')).items():
        out=DISC/'remix-mask'/name
        out.parent.mkdir(parents=True,exist_ok=True)
        out.write_bytes(data)
        report['files'][f'remix-mask/{name}']=hashlib.sha256(data).hexdigest()
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
    layouts = [(f'{game}/layout', layout) for game, layout in LAYOUT.items()]
    layouts += [(f'{game}/lyric-layout', layout) for game, layout in LYRIC_LAYOUT.items()]
    layouts += [(f'message-layout/{key}', layout) for key, layout in MESSAGE_LAYOUTS.items()]
    for folder, layout in layouts:
        files = u8_files(disc.get(layout['archive']))
        for name, data in files.items():
            out = DISC/folder/name
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            report['files'][f'{folder}/{name}'] = hashlib.sha256(data).hexdigest()
        # Fonts not in the archive are stand-alone compressed files next to the layouts.
        for font in layout_fonts(files['blyt/'+layout['file']]):
            if 'font/'+font not in files:
                data = yaz0(disc.get('EN/content2/'+font.rsplit('.', 1)[0]+'.szs'))
                (DISC/'font').mkdir(exist_ok=True)
                (DISC/'font'/font).write_bytes(data)
                report['files'][f'font/{font}'] = hashlib.sha256(data).hexdigest()
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
