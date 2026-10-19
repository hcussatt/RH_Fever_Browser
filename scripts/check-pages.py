#!/usr/bin/env python3
"""Audit the deploy artifact independently of Git's ignored-file rules."""
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('clean', ROOT/'scripts/check-clean.py')
clean = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clean)


def audit(site):
    build = json.loads((site/'deployment.json').read_text())
    games = {p.parent.name for p in (ROOT/'runtime-src').glob('*/original-functions.inc')}
    allowed = {'index.html', 'games.json', '.nojekyll', 'deployment.json', 'sw.js', 'import/tools.zip'}
    allowed.update(str(p.relative_to(ROOT/'web')) for p in (ROOT/'web/import').iterdir() if p.is_file())
    allowed.update('engine/'+p.name for p in (ROOT/'web/engine').glob('*.mjs'))
    for game in games:
        allowed.update(f'{game}/{name}' for name in ['index.html', 'game.json', f'{game}-core.mjs', f'{game}-core.wasm'])
    actual = {str(p.relative_to(site)) for p in site.rglob('*') if p.is_file()}
    assert actual == allowed, f'Unexpected/missing deploy files: {actual ^ allowed}'
    assert set(build['files']) == actual-{'deployment.json', 'sw.js'}, 'Deployment manifest is incomplete'
    blocks = clean.reference_blocks()
    for name in sorted(actual):
        path = site/name
        assert not path.is_symlink(), f'Symlink in deployment: {name}'
        data = path.read_bytes()
        if name in build['files']:
            assert hashlib.sha256(data).hexdigest() == build['files'][name], f'Checksum mismatch: {name}'
        if name.endswith('-core.wasm'):
            assert data.startswith(b'\x00asm'), name
            # The only permitted binary is a per-game compiled runtime.
            continue
        if name == 'import/tools.zip':
            with zipfile.ZipFile(path) as archive:
                for item in archive.infolist():
                    assert not item.is_dir() and not item.filename.startswith('/') and '..' not in Path(item.filename).parts
                    assert item.filename.startswith(('tools/', 'games/')) and item.filename.endswith(('.py', '/game.json'))
                    assert not clean.check(item.filename, archive.read(item), blocks), item.filename
            continue
        if name.endswith(('.mjs', '.js')):
            for dependency in re.findall(r"(?:from\s*|import\s*\(?\s*)['\"](\.[^'\"]+)['\"]", data.decode()):
                target = (path.parent/dependency).resolve()
                assert target.is_relative_to(site.resolve()) and target.is_file(), f'{name}: missing module {dependency}'
        problems = clean.check(name, data, blocks)
        assert not problems, f'{name}: {problems}'
    expected = hashlib.sha256(json.dumps(build['files'], sort_keys=True).encode()).hexdigest()[:20]
    assert build['version'] == expected, 'Runtime version does not match artifact'
    assert '__VERSION__' not in (site/'sw.js').read_text()
    print(f'Public artifact clean: {len(actual)} files, runtime {expected}; no imported assets')


if __name__ == '__main__':
    audit(ROOT/'site' if len(sys.argv) == 1 else Path(sys.argv[1]))
