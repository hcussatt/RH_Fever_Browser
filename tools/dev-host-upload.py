#!/usr/bin/env python3
"""Upload the games ./build.sh prepared in dist/ to the owner's private dev host (docs/dev-host.md).

  python3 tools/dev-host-upload.py --new-keys   make the two keys once (kept in local/, git-ignored)
  python3 tools/dev-host-upload.py              upload dist/ (only files the host does not have yet)

The files are Nintendo's: they go only to the key-gated Worker, never to git or Pages.
"""
import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import re
import secrets
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from game_registry import web_games
from import_version import import_version
from wii_files import common_key

ROOT = Path(__file__).resolve().parents[1]
KEYS = ROOT/'local/dev-host.env'
DEFAULT_URL = 'https://rhf-devhost.hcussatt.workers.dev/'
SITE = 'https://hcussatt.github.io/RH_Fever_Browser/'
# The same files the in-browser importer keeps (web/import/worker.mjs).
KEEP = re.compile(r'.*\.(json|png|wav)$|^(data-[0-9a-f]+|sequence-\d+)\.bin$')


def mime(name):
    return {'.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav'}.get(Path(name).suffix, 'application/octet-stream')


def read_keys():
    if not KEYS.is_file():
        raise SystemExit('No keys yet. Run: python3 tools/dev-host-upload.py --new-keys')
    return dict(line.split('=', 1) for line in KEYS.read_text().split() if '=' in line)


def new_keys():
    if KEYS.exists():
        raise SystemExit(f'{KEYS} already exists; keeping the current keys.')
    KEYS.parent.mkdir(exist_ok=True)
    dev, upload = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    KEYS.write_text(f'RHF_DEV_KEY={dev}\nRHF_UPLOAD_KEY={upload}\nRHF_DEV_HOST={DEFAULT_URL}\n')
    KEYS.chmod(0o600)
    print(f'Saved both keys to {KEYS} (git-ignored). Keep them private: the dev key unlocks the game files.\n')
    print('Add these two repository secrets (GitHub > Settings > Secrets and variables > Actions):')
    print(f'  RHF_DEV_KEY     {dev}')
    print(f'  RHF_UPLOAD_KEY  {upload}\n')
    print('Then open this dev link once in each browser you play on:')
    print(f'  {SITE}#dev={dev}')


def context():
    # python.org builds on macOS can lack CA certificates; certifi fixes that when installed.
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def request(url, key, method='GET', data=None, content_type=None):
    headers = {'authorization': 'Bearer '+key, 'user-agent': 'rhf-dev-host-upload'}
    if content_type:
        headers['content-type'] = content_type
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, context=CONTEXT, timeout=300) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        if e.code in (401, 503, 507):
            raise SystemExit(f'Dev host refused the upload ({e.code}): {e.read().decode(errors="replace")}')
        return e.code, b''


def upload(host, key, jobs):
    games = [g['id'] for g in web_games(ROOT, validate=False, require_runtime=False)]
    missing = [g for g in games if not (ROOT/'dist'/g/'assets/original-timeline.json').is_file()]
    if missing:
        raise SystemExit('Build these games first (./build.sh): '+' '.join(missing))
    # The site no longer includes the Wii common key; dev-key holders get it from here instead.
    manifest = {'importVersion': import_version(ROOT), 'wiiCommonKey': common_key().hex(), 'uploadedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'games': {}}
    try:
        manifest['commit'] = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    paths = {}
    for game in games:
        files, size = {}, 0
        for path in sorted((ROOT/'dist'/game/'assets').iterdir()):
            if path.is_file() and KEEP.match(path.name):
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                files[path.name] = digest
                paths.setdefault(digest, path)
                size += path.stat().st_size
        manifest['games'][game] = {'files': files, 'bytes': size}
    status, body = request(host+'manifest.json', key)
    known = set()
    if status == 200:
        for entry in json.loads(body)['games'].values():
            known.update(entry['files'].values())
    todo = [d for d in paths if d not in known]
    total = sum(paths[d].stat().st_size for d in todo)
    print(f'{len(games)} games, {len(paths)} distinct files; {len(todo)} to check ({total/1048576:.0f} MB at most).')

    def send(digest):
        url = host+'files/'+digest
        if request(url, key, 'HEAD')[0] == 200:
            return 0
        status, _ = request(url, key, 'PUT', paths[digest].read_bytes(), mime(paths[digest].name))
        if status != 201:
            raise RuntimeError(f'{paths[digest]}: upload failed ({status})')
        return paths[digest].stat().st_size

    sent = 0
    with ThreadPoolExecutor(jobs) as pool:
        for i, size in enumerate(pool.map(send, todo), 1):
            sent += size
            if i % 50 == 0 or i == len(todo):
                print(f'  {i}/{len(todo)} checked, {sent/1048576:.0f} MB sent')
    # The manifest goes last, so a browser never sees files listed that are not there yet.
    status, _ = request(host+'manifest.json', key, 'PUT', json.dumps(manifest).encode(), 'application/json')
    if status != 201:
        raise SystemExit(f'Manifest upload failed ({status}).')
    print(f'Done. Dev host now has commit {manifest.get("commit", "?")} (import version {manifest["importVersion"]}).')
    print('In the browser: Load disc > Download from dev host.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--new-keys', action='store_true', help='create the dev and upload keys in local/dev-host.env')
    parser.add_argument('--jobs', type=int, default=8, help='parallel uploads (default 8)')
    args = parser.parse_args()
    if args.new_keys:
        new_keys()
        sys.exit()
    CONTEXT = context()
    keys = read_keys()
    upload(keys.get('RHF_DEV_HOST', DEFAULT_URL).rstrip('/')+'/', keys['RHF_UPLOAD_KEY'], args.jobs)
