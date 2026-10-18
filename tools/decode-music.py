#!/usr/bin/env python3
"""Decode a game's backing track from its original RWAV into music.wav/music.json.
Pass --verify to cross-check the DSP-ADPCM layout against FFmpeg (must be installed)."""
import json
import sys
from nintendo_audio import wave_files, decode_wave, write_wav
from paths import assets, game, require

# BRSAR file whose wave archive holds each game's music stream.
MUSIC = {'golf': 35, 'tap': 131}

name = game()
out = assets(name)
data = require(out/f'wave-{MUSIC[name]}.bin').read_bytes()
(wave,) = list(wave_files(data))
pcm, meta = decode_wave(wave, verify='--verify' in sys.argv)
write_wav(out/'music.wav', pcm, meta['rate'])
(out/'music.json').write_text(json.dumps(meta, indent=2)+'\n')
print(f'{name}: music.wav {meta["samples"]} samples at {meta["rate"]} Hz')
