#!/usr/bin/env python3
"""Decode a game's backing track from its original RWAV into music.wav/music.json.
Pass --verify to cross-check the DSP-ADPCM layout against FFmpeg (must be installed)."""
import json
import struct
import sys
from nintendo_audio import wave_files, decode_wave, write_wav
from paths import assets, game, require

name = game()
out = assets(name)
# BRSAR file whose wave archive holds the game's music stream (found by extract-assets.py).
audio = json.loads(require(out/'original-assets.json').read_text())['audio']
def decode(sound, stem):
    """The wave a sound record plays: one RWSD can hold several (the rhythm test's greeting tune,
    with and without its intro), each data entry naming its wave in its first note."""
    file = audio['sounds'][str(sound)]['fileId']
    waves = list(wave_files(require(out/f'wave-{file}.bin').read_bytes()))
    if len(waves) > 1:
        rwsd = require(out/audio['files'][str(file)]['metadata']).read_bytes()
        u32 = lambda o: struct.unpack_from('>I', rwsd, o)[0]
        block = u32(16); base = block+8
        entry = base+u32(block+12+audio['sounds'][str(sound)]['data'][0]*8+4)
        notes = base+u32(entry+20)
        waves = [waves[u32(base+u32(notes+8))]]
    (wave,) = waves
    pcm, meta = decode_wave(wave, verify='--verify' in sys.argv)
    # The sound record's volume byte, applied linearly by the mixer (web/engine/audio.mjs).
    meta['volume'] = audio['sounds'][str(sound)]['volume']
    write_wav(out/f'{stem}.wav', pcm, meta['rate'])
    (out/f'{stem}.json').write_text(json.dumps(meta, indent=2)+'\n')
    return meta


chart = json.loads(require(out/'original-chart.json').read_text())
meta = decode(chart['musicSound'], 'music')
print(f'{name}: music.wav {meta["samples"]} samples at {meta["rate"]} Hz')
# The practice's backing waves (they loop while the practice repeats).
for sound in chart.get('practice', {}).get('waves', []):
    meta = decode(sound, f'practice-{sound}')
    print(f'{name}: practice-{sound}.wav {meta["samples"]} samples, loop {meta["loop"]} from {meta["loopStart"]}')
