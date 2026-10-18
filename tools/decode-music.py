#!/usr/bin/env python3
"""Decode a game's backing track from its original RWAV into music.wav/music.json.
Pass --verify to cross-check the DSP-ADPCM layout against FFmpeg (must be installed)."""
import json
import sys
from nintendo_audio import wave_files, decode_wave, write_wav
from paths import assets, game, manifest, require

name = game()
out = assets(name)
# BRSAR file whose wave archive holds the game's music stream.
data = require(out/f'wave-{manifest(name)["wii"]["music"]}.bin').read_bytes()
(wave,) = list(wave_files(data))
pcm, meta = decode_wave(wave, verify='--verify' in sys.argv)
write_wav(out/'music.wav', pcm, meta['rate'])
(out/'music.json').write_text(json.dumps(meta, indent=2)+'\n')
print(f'{name}: music.wav {meta["samples"]} samples at {meta["rate"]} Hz')
