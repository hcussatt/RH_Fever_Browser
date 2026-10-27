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
music = audio['musicFile']
data = require(out/f'wave-{music}.bin').read_bytes()
# Sound record whose wave the music is: one RWSD can hold several (the rhythm test's greeting
# tune, with and without its intro), each data entry naming its wave in its first note.
sound = json.loads(require(out/'original-chart.json').read_text())['musicSound']
waves = list(wave_files(data))
if len(waves) > 1:
    rwsd = require(out/audio['files'][str(music)]['metadata']).read_bytes()
    u32 = lambda o: struct.unpack_from('>I', rwsd, o)[0]
    block = u32(16); base = block+8
    entry = base+u32(block+12+audio['sounds'][str(sound)]['data'][0]*8+4)
    notes = base+u32(entry+20)
    waves = [waves[u32(base+u32(notes+8))]]
(wave,) = waves
pcm, meta = decode_wave(wave, verify='--verify' in sys.argv)
# The sound record's volume byte, applied linearly by the mixer (web/engine/audio.mjs).
meta['volume'] = audio['sounds'][str(sound)]['volume']
write_wav(out/'music.wav', pcm, meta['rate'])
(out/'music.json').write_text(json.dumps(meta, indent=2)+'\n')
print(f'{name}: music.wav {meta["samples"]} samples at {meta["rate"]} Hz')
