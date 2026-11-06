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
import struct
import tempfile


def adts_frames(data):
    count, at = 0, 0
    while at + 7 <= len(data) and data[at] == 0xff and data[at + 1] & 0xf0 == 0xf0:
        length = (data[at + 3] & 3) << 11 | data[at + 4] << 3 | data[at + 5] >> 5
        if not length:
            break
        at += length
        count += 1
    return count


def wav_pcm16_stereo(data, path):
    """The samples of a 16-bit stereo WAV, plain or WAVE_FORMAT_EXTENSIBLE (afconvert writes the latter)."""
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise SystemExit(f'{path}: afconvert did not write a WAV file')
    at, fmt = 12, None
    while at + 8 <= len(data):
        kind, size = data[at:at + 4], struct.unpack('<I', data[at + 4:at + 8])[0]
        body = data[at + 8:at + 8 + size]
        if kind == b'fmt ':
            fmt = struct.unpack('<HHIIHH', body[:16])
        elif kind == b'data':
            if not fmt or fmt[1] != 2 or fmt[5] != 16 or fmt[0] not in (1, 0xfffe):
                raise SystemExit(f'{path}: afconvert gave format {fmt}, expected 16-bit stereo PCM')
            return body
        at += 8 + size + (size & 1)
    raise SystemExit(f'{path}: no audio in the WAV afconvert wrote')


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
            pcm = wav_pcm16_stereo(open(out, 'rb').read(), path)
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
