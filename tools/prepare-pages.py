#!/usr/bin/env python3
"""Stage only public runtime files. Never copy a dist/ assets directory.

--snapshot records translated C for ISO-free CI builds after a local build.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile
from game_registry import web_games

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ['paths.py', 'wii_files.py', 'extract-disc.py', 'prepare-data.py',
         'chart-index.py', 'extract-assets.py', 'extract-sfx.py',
         'extract-layout.py', 'extract-results.py', 'decode-music.py', 'nintendo_audio.py']


def stage(snapshot=False, output='site'):
    registered = web_games(ROOT, require_runtime=not snapshot)
    games = [m['id'] for m in registered]
    if snapshot:
        for game in games:
            target = ROOT/'runtime-src'/game
            target.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT/'build'/game/'original-functions.inc', target/'original-functions.inc')
            if 'scenes' in next(m for m in registered if m['id'] == game)['wii']:
                shutil.copyfile(ROOT/'build'/game/'scenes.h', target/'scenes.h')
    out = ROOT/output
    if out.resolve() != ROOT/'site':
        raise SystemExit('Public output must be site/ (avoids deleting source directories).')
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    shutil.copytree(ROOT/'web/engine', out/'engine', ignore=shutil.ignore_patterns('qa', 'index.html', '.DS_Store'))
    shutil.copytree(ROOT/'web/import', out/'import', ignore=shutil.ignore_patterns('.DS_Store'))
    shutil.copyfile(ROOT/'web/library.html', out/'index.html')
    (out/'.nojekyll').touch()
    manifests = []
    # Scene IDs are metadata, not charts. Keep the importer independent of the submodule.
    text = (ROOT/'third_party/rhf-decomp/src/Game/SceneManager.hpp').read_text()
    names = re.findall(r'eScene_(\w+)', text.split('enum ESceneID', 1)[1].split('};', 1)[0])
    scenes = {name: i for i, name in enumerate(names) if name not in ('Count', 'Null')}
    labels = (ROOT/'third_party/rhf-decomp/build_default/SOME01/include/rev_tengoku.rsid').read_text()
    remix_music = {m['wii']['music'] for m in registered if 'music' in m['wii']}
    result_sounds = {i: n for n, i in re.findall(r'unsigned int (\w+) = (\d+);', labels)
                     if n.startswith(('WSD_RESULT_', 'WSD_EPILOGUE_')) or n in remix_music}
    for game in games:
        d = out/game
        d.mkdir()
        manifest = next(m for m in registered if m['id'] == game)
        if 'scene' in manifest['wii']:
            if manifest['wii']['scene'] not in scenes:
                raise ValueError(f'{game}: unknown Wii scene {manifest["wii"]["scene"]}')
            manifest['wii']['sceneId'] = scenes[manifest['wii']['scene']]
        manifest.pop('$schema', None)
        manifest['wii']['soundNames'] = result_sounds
        (d/'game.json').write_text(json.dumps(manifest)+'\n')
        shutil.copyfile(ROOT/'web/engine/index.html', d/'index.html')
        for name in [f'{game}-core.mjs', f'{game}-core.wasm']:
            shutil.copyfile(ROOT/'dist'/game/name, d/name)
        manifests.append(manifest)
    with zipfile.ZipFile(out/'import/tools.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in TOOLS:
            info = zipfile.ZipInfo('tools/'+name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, (ROOT/'tools'/name).read_bytes())
        for manifest in manifests:
            info = zipfile.ZipInfo(f'games/{manifest["id"]}/game.json', date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, json.dumps(manifest))
    (out/'games.json').write_text(json.dumps([{'id': m['id'], 'title': m['title'], 'expectedCues': m['web']['expectedCues']} for m in manifests])+'\n')
    files = sorted(p for p in out.rglob('*') if p.is_file())
    checksums = {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    version = hashlib.sha256(json.dumps(checksums, sort_keys=True).encode()).hexdigest()[:20]
    compatibility = {name: digest for name, digest in checksums.items()
                     if name.endswith(('.wasm', '/game.json')) or name == 'import/tools.zip'}
    asset_version = hashlib.sha256(json.dumps(compatibility, sort_keys=True).encode()).hexdigest()[:20]
    (out/'deployment.json').write_text(json.dumps({'version': version, 'assetVersion': asset_version, 'isoId': 'SOME01',
        'dolSha1': 'd96d2c7e50b0c713cb8fcb18835258351ada5576', 'files': checksums})+'\n')
    worker = (ROOT/'web/sw.js').read_text().replace('__VERSION__', version).replace('__FILES__', json.dumps(list(checksums)+['deployment.json']))
    (out/'sw.js').write_text(worker)
    print(f'Public site: {out}; runtime {version}; {len(checksums)} files; no imported assets')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', action='store_true')
    args = parser.parse_args()
    stage(snapshot=args.snapshot)
