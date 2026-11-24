#!/usr/bin/env python3
"""Refuse to commit anything that comes from the game or the Wii.

Checks every file that would be committed (staged files with --staged,
otherwise all tracked files) for:
  * paths under build/, dist/, local/ or .toolchain/ (generated or private)
  * disc images, executables, Nintendo archive/sound/graphics formats,
    compiled WASM, and decoded media, by extension and by file signature
  * translated original code outside the explicitly approved runtime-src snapshots
  * the Wii common key outside its explicitly authorized public importer module
  * any 64-byte run copied from main.dol or the cellanim files, when a local
    build/disc/ exists to compare against
Exit status 1 lists every problem found.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from game_registry import web_games
BLOCKED_DIRS = ('build/', 'dist/', 'local/', '.toolchain/')
# Runtime code publication is authorized; assets and original data are not.
# Keep the allowance exact, not a blanket exception for generated files.
RUNTIME_SOURCES = {f'runtime-src/{game["id"]}/original-functions.inc' for game in web_games(ROOT, validate=False)}
BLOCKED_EXT = {
    '.iso', '.wbfs', '.rvz', '.ciso', '.gcz', '.wia', '.nkit', '.wad', '.tik', '.tmd',
    '.dol', '.elf', '.rel', '.o', '.a', '.map',
    '.szs', '.arc', '.u8', '.carc', '.brsar', '.brstm', '.brwsd', '.brbnk', '.brseq', '.brwar',
    '.rwar', '.rwav', '.rseq', '.rbnk', '.rwsd', '.brcad', '.tpl', '.brlyt', '.brlan', '.brfnt',
    '.cia', '.3ds', '.cci', '.cxi', '.cfa', '.ncch', '.romfs', '.exefs', '.bccad', '.bcsar', '.bcstm',
    '.bcwav', '.bcseq', '.bcwar', '.bcbnk', '.bcgrp', '.ctpk', '.bclim', '.bflim', '.bcfnt', '.tickflow', '.zlib',
    '.bin', '.inc', '.wasm', '.wav', '.ogg', '.mp3', '.png', '.jpg', '.jpeg', '.gif', '.webp',
}
SIGNATURES = {
    b'Yaz0': 'Yaz0 archive', b'\x55\xaa\x38\x2d': 'U8 archive', b'RSAR': 'sound archive',
    b'RWAR': 'wave archive', b'RWAV': 'wave', b'RSEQ': 'sequence', b'RBNK': 'sound bank',
    b'RWSD': 'sound data', b'RLYT': 'layout', b'RLAN': 'layout animation', b'\x00asm': 'WASM',
    b'NCSD': '3DS image', b'NCCH': '3DS program', b'IVFC': '3DS RomFS', b'CSAR': '3DS sound archive',
    b'CWAV': '3DS wave', b'CSTM': '3DS stream', b'CSEQ': '3DS sequence', b'CWAR': '3DS wave archive',
    b'CBNK': '3DS sound bank', b'CTPK': '3DS textures', b'\x89PNG': 'PNG image', b'RIFF': 'RIFF media', b'\x00\x20\xaf\x30': 'TPL texture',
}
COMMON_KEY_SHA256 = 'de38aeab4fe0c36d828a47e6fd315100e7ce234d3b00aa25e6ad6f5ff2824af8'
MAX_BYTES = 1_000_000
# An approved runtime snapshot holds every scene's translated code for a remix (Remix 8 has seven).
MAX_RUNTIME_SOURCE_BYTES = 4_000_000
WINDOW = 64


def files(staged):
    args = ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] if staged else ['git', 'ls-files', '-z']
    names = subprocess.check_output(args, cwd=ROOT).decode().split('\0')
    for name in filter(None, names):
        if staged:
            mode = subprocess.check_output(['git', 'ls-files', '-s', '--', name], cwd=ROOT).decode().split(' ')[0]
            if mode == '160000':
                continue  # submodule pointer, not content
            data = subprocess.check_output(['git', 'show', ':'+name], cwd=ROOT)
        else:
            path = ROOT/name
            if path.is_dir() or not path.exists():
                continue
            data = path.read_bytes()
        yield name, data


def reference_blocks():
    disc = ROOT/'build/disc'
    sources = [disc/'main.dol'] + [p for p in disc.glob('*/*') if p.is_file() and p.stat().st_size < 20_000_000]
    blocks = set()
    for source in sources:
        if source.exists():
            data = source.read_bytes()
            for i in range(0, len(data)-WINDOW+1, 4):
                chunk = data[i:i+WINDOW]
                if len(set(chunk)) > 8:   # skip padding and other trivial runs
                    blocks.add(hashlib.blake2b(chunk, digest_size=8).digest())
    return blocks


def check(name, data, blocks):
    problems = []
    lower = name.lower()
    if lower.startswith(BLOCKED_DIRS):
        problems.append('generated or private folder')
    if pathlib.PurePosixPath(lower).suffix in BLOCKED_EXT and name not in RUNTIME_SOURCES:
        problems.append('blocked file type')
    if 'rhythm heaven' in lower and lower.endswith(('.iso', '.zip')):
        problems.append('looks like a game image')
    for magic, label in SIGNATURES.items():
        if data.startswith(magic):
            problems.append(label)
    if len(data) >= 0x1c and data[0x18:0x1c] == b'\x5d\x1c\x9e\xa3':
        problems.append('Wii disc image')
    limit = MAX_RUNTIME_SOURCE_BYTES if name in RUNTIME_SOURCES else MAX_BYTES
    if len(data) > limit:
        problems.append(f'larger than {limit} bytes')
    text = data.decode('latin-1')
    if re.search(r'static void p_8[0-9a-f]{7}\(void\)', text) and name not in RUNTIME_SOURCES:
        problems.append('translated original code')
    for candidate in re.findall(r'(?:0x)?[0-9a-fA-F]{2}(?:[\s,]*(?:0x)?[0-9a-fA-F]{2}){15}', text):
        digits = re.sub(r'0x|[^0-9a-fA-F]', '', candidate)
        if len(digits) == 32 and hashlib.sha256(bytes.fromhex(digits)).hexdigest() == COMMON_KEY_SHA256:
            problems.append('Wii common key')
    if blocks:
        for i in range(0, max(0, len(data)-WINDOW+1)):
            if hashlib.blake2b(data[i:i+WINDOW], digest_size=8).digest() in blocks:
                problems.append(f'contains bytes copied from the disc (offset {i})')
                break
    return problems


def main():
    staged = '--staged' in sys.argv
    blocks = reference_blocks()
    failed = False
    for name, data in files(staged):
        for problem in check(name, data, blocks):
            print(f'BLOCKED {name}: {problem}')
            failed = True
    if failed:
        print('\nGame material remains blocked outside the exact approved runtime/key modules. Generated files belong in build/ or dist/.')
        sys.exit(1)
    print('Clean: no unapproved game or Wii material found' + ('' if blocks else ' (no local disc files to compare against)'))


if __name__ == '__main__':
    main()
