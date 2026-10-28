"""Fingerprint of everything that decides a game's prepared files: the converters, the game
manifests and the chart tracer. The hosted site publishes it as importVersion in
deployment.json, and tools/dev-host-upload.py stamps it on what it uploads, so the site can tell
whether the dev host's files still match it (docs/dev-host.md)."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# The converters the in-browser importer runs (tools/prepare-pages.py zips these).
TOOLS = ['paths.py', 'wii_files.py', 'extract-disc.py', 'prepare-data.py',
         'chart-index.py', 'extract-assets.py', 'extract-sfx.py',
         'extract-layout.py', 'extract-results.py', 'extract-menu.py', 'decode-music.py', 'nintendo_audio.py']


def import_version(root=ROOT):
    root = Path(root)
    names = (['tools/'+name for name in TOOLS]+['web/engine/timeline.mjs']
             +sorted(str(p.relative_to(root)) for p in (root/'games').glob('*/game.json')))
    digests = {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in names}
    return hashlib.sha256(json.dumps(digests, sort_keys=True).encode()).hexdigest()[:20]
