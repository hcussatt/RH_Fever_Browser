#!/usr/bin/env python3
"""Decode the game's music (ADTS .aac from the user's dump) to 16-bit stereo PCM next to each file
(file.aac.pcm), the form the harness and the browser build read.

Usage: decode-aac.py file.aac ...

The harness answers the game's DSP with block N of the PCM for ADTS frame N, so the output must
hold exactly 1024 samples per frame, starting at frame 0. ffmpeg does that. Without ffmpeg (a stock
Mac), macOS's afconvert decodes; Apple's decoder may drop the encoder delay at the start, so the
result is padded back to one block per frame (the dropped samples are silence) and checked.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import wave


def adts_frames(data):
    count, at = 0, 0
    while at + 7 <= len(data) and data[at] == 0xff and data[at + 1] & 0xf0 == 0xf0:
        length = (data[at + 3] & 3) << 11 | data[at + 4] << 3 | data[at + 5] >> 5
        if not length:
            break
        at += length
        count += 1
    return count


def decode(path):
    frames = adts_frames(open(path, 'rb').read())
    want = frames * 1024 * 4
    if shutil.which('ffmpeg'):
        pcm = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', path, '-f', 's16le', '-ac', '2', '-'],
                             check=True, stdout=subprocess.PIPE).stdout
        how = 'ffmpeg'
    elif shutil.which('afconvert'):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, 'out.wav')
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16', '-c', '2', path, out], check=True)
            with wave.open(out) as w:
                if w.getnchannels() != 2 or w.getsampwidth() != 2:
                    raise SystemExit(f'{path}: afconvert gave {w.getnchannels()} channels, {8 * w.getsampwidth()}-bit')
                pcm = w.readframes(w.getnframes())
        how = 'afconvert'
        short = want - len(pcm)
        if 0 < short <= 2112 * 4:  # the encoder delay Apple's decoder skips: put it back at the start
            pcm = bytes(short) + pcm
    else:
        raise SystemExit('Decoding the music needs ffmpeg or afconvert (macOS). Install ffmpeg, e.g. brew install ffmpeg.')
    if len(pcm) != want:
        print(f'warning: {path}: {how} gave {len(pcm) // 4} samples for {frames} frames '
              f'(expected {want // 4}); music may be offset', file=sys.stderr)
        pcm = pcm[:want].ljust(want, b'\0')
    open(path + '.pcm', 'wb').write(pcm)


for name in sys.argv[1:]:
    decode(name)
