#!/usr/bin/env python3
"""Find a minigame's main chart and its backing-track tempo in the original DOL.

The game reaches a minigame's chart through a TickFlow scene change
(TF_SET_SCENE, op 0x100) naming the game's scene. The main chart is the
target that sets up grading (op 0x118, arg0 1), unlike the tutorial. Its
PREPARE_WAVE command names the backing track, whose tempo table the game's
CSoundManager keeps in a wave-info table. The sound groups the game loads
come from the loading charts: group loads (op 0x12c) just before the scene
is prepared (ops 0x101 and 0x102). Nothing here is per-game code.

Writes dist/<game>/assets/original-chart.json, read by tools/chart-timeline.mjs.
"""
import json
import re
import struct

from paths import DECOMP, DOL, assets, game, manifest, require

data = require(DOL).read_bytes()
u32o = lambda o: struct.unpack_from('>I', data, o)[0]
SECTIONS = [(u32o(i*4), u32o(0x48+i*4), u32o(0x90+i*4)) for i in range(18) if u32o(0x90+i*4)]
WAVE_INFO_TABLE = 0x802e8210  # CSoundManager::set_wave_info_table data, 162 entries
WAVE_INFO_COUNT = 162


def read(address, n):
    for offset, start, size in SECTIONS:
        if start <= address and address+n <= start+size:
            return data[offset+address-start:offset+address-start+n]
    raise ValueError(hex(address))


def u32(address):
    return struct.unpack('>I', read(address, 4))[0]


def instruction(address):
    word = u32(address)
    argc = (word >> 10) & 15
    return word & 1023, word >> 14, [u32(address+4+4*i) for i in range(argc)], address+4+4*argc


def commands(start, depth=0, limit=4096):
    """Commands of one chart until TF_STOP/TF_RETURN, following TF_CALL once."""
    address = start
    for _ in range(limit):
        try:
            op, arg0, args, following = instruction(address)
        except ValueError:
            return
        yield address, op, arg0, args
        if op in (2, 3):
            return
        if op == 1 and depth == 0:
            yield from commands(args[0], 1, limit)
        address = following


def scene_ids():
    text = (DECOMP/'src/Game/SceneManager.hpp').read_text()
    names = re.findall(r'eScene_(\w+)', text.split('enum ESceneID', 1)[1].split('};', 1)[0])
    return {n: i for i, n in enumerate(names) if n not in ('Count', 'Null')}


def scene_changes(scene):
    """(chart, variant) of every TF_SET_SCENE(scene, chart) command in the data sections. The variant is the
    second argument of the scene-load command (0x101) just before it; Hole in One, for example, has two
    main charts that differ only in it."""
    word = (2 << 10) | 0x100  # op 0x100, 2 args, arg0 0
    load = (2 << 10) | 0x101
    targets = set()
    for offset, start, size in SECTIONS:
        for o in range(offset+12, offset+size-12, 4):
            if u32o(o) == word and u32o(o+4) == scene and 0x80000000 <= u32o(o+8) < 0x81800000:
                variant = u32o(o-4) if u32o(o-12) == load and u32o(o-8) == scene else None
                targets.add((u32o(o+8), variant))
    return sorted(targets)


SCENE_VERSION_TABLE = 0x802ed02c  # jump table of CSceneManager::fn_8008A4DC(scene, version), 65 scenes
SDA_BASE = 0x80326ec0  # r13


def scene_version_address(scene):
    """The static where CSceneManager::fn_8008A4DC keeps this scene's version (Date::sceneVer, for
    example): its jump table case is a single stw r5,offset(r13) and blr."""
    case = struct.unpack('>I', read(SCENE_VERSION_TABLE+scene*4, 4))[0]
    store, ret = struct.unpack('>2I', read(case, 8))
    if store >> 16 != 0x90ad or ret != 0x4e800020:
        raise SystemExit(f'Scene {scene}: unexpected version setter at {case:#x}')
    return SDA_BASE+struct.unpack('>h', struct.pack('>H', store & 0xffff))[0]


def group_loads(scene):
    """Sound groups loaded (op 0x12c) by each chart that then prepares the scene (0x101, 0x102).
    Remixes prepare the same scene with their own loads; tools/extract-assets.py keeps the
    loads that include the main chart's music."""
    prepare = (1 << 10) | 0x102
    loads = []
    for offset, start, size in SECTIONS:
        for o in range(offset+12, offset+size-8, 4):
            if u32o(o) != prepare or u32o(o+4) != scene or u32o(o-12) & 0x3fff != (2 << 10) | 0x101 or u32o(o-8) != scene:
                continue
            groups = []
            for back in range(o-16, max(offset, o-512), -4):
                word = u32o(back)
                if word == (1 << 10) | 0x004:  # the loading chart's first command
                    break
                if word & 0x3fff == (1 << 10) | 0x12c:
                    groups.insert(0, u32o(back+4))
            if groups and groups not in loads:
                loads.append(groups)
    return loads


def tempo_segments(sound):
    for i in range(WAVE_INFO_COUNT):
        sid, rate, table = struct.unpack('>HHI', read(WAVE_INFO_TABLE+i*8, 8))
        if sid == sound:
            break
    else:
        raise SystemExit(f'No tempo data for wave sound {sound}')
    segments = []
    while True:
        beats, samples, flag, _ = struct.unpack('>IIHH', read(table+len(segments)*12, 12))
        segments.append({'beats': beats, 'samples': samples, 'rate': rate})
        if flag & 0x8001:
            return segments, table


def main():
    name = game()
    profile = manifest(name)['wii']
    scene = profile['sceneId'] if 'sceneId' in profile else scene_ids()[profile['scene']]
    mains = [(t, v) for t, v in scene_changes(scene) if any(op == 0x118 and arg0 == 1 for _, op, arg0, _ in commands(t))]
    if 'sceneVariant' in profile:
        mains = [(t, v) for t, v in mains if v == profile['sceneVariant']]
    if len({t for t, _ in mains}) != 1:
        found = ', '.join(f'{t:#x} (variant {v})' for t, v in mains)
        raise SystemExit(f'{name}: expected one main chart for scene {profile["scene"]}, found [{found}]; '
                         'set "sceneVariant" in the manifest to pick one')
    start = mains[0][0]
    music = next(arg0 for _, op, arg0, _ in commands(start) if op == 0x37)  # TF_PREPARE_WAVE
    segments, table = tempo_segments(music)
    out = {'scene': profile['scene'], 'sceneId': scene, 'start': start, 'musicSound': music, 'tempoAddress': table,
           'beatCount': sum(s['beats'] for s in segments), 'sampleCount': sum(s['samples'] for s in segments),
           'sampleRate': segments[0]['rate'], 'groupLoads': group_loads(scene),
           'secondsPerTick': segments[0]['samples']/segments[0]['rate']/(segments[0]['beats']*48)}
    # The scene load before the chart (op 0x101) passes the scene's version, which the scene reads
    # to pick its setup (Double Date seats the girl beside the boy in version 1).
    if mains[0][1]:
        out['sceneVersion'] = {'address': scene_version_address(scene), 'value': mains[0][1]}
    if len(segments) > 1:
        out['tempoSegments'] = segments
    (assets(name)/'original-chart.json').write_text(json.dumps(out, indent=2)+'\n')
    print(f'{name}: chart {start:#x}, music sound {music}, {len(segments)} tempo segment(s)')


if __name__ == '__main__':
    main()
