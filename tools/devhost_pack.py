"""Packs a game's prepared files into a few compressed parts for the dev host (docs/dev-host.md).
web/import/devpack.mjs unpacks them in the browser, and every rebuilt file must match the SHA-256
the manifest lists for it, so nothing reaches the cache unless it is byte-identical.

A part is b'RHFP', a little-endian uint32 header length, the header (UTF-8 JSON) and then each
entry's payload. Codecs:
  store    PNGs, which are compressed already.
  deflate  raw deflate (JSON, charts, data).
  pcm16    16-bit PCM WAVs, losslessly: the bytes around the samples are kept as they are, and
           the samples become prediction residuals, packed as byte planes and deflated.

pcm16 in detail. Samples are cut into blocks of BLOCK frames. For each block and channel one
choice byte names a fixed predictor (order 0 to 3, as in FLAC), plus 4 when a channel after the
first is coded as its difference from channel 0. Every predictor reads the coded signal's own
history across block edges, with zeros before the first sample. Residuals and differences wrap
around modulo 2**16, so they stay 16-bit and decode exactly. Each residual is zigzagged, and
the payload is: head bytes, trailer bytes, choice bytes (block-major), then per channel all low
bytes and all high bytes. The whole payload is deflated.

Encoding is deterministic, so an unchanged game makes the same parts and is not uploaded again.
"""
import hashlib
import json
import struct
import zlib
import numpy as np

MAGIC = b'RHFP'
PART_LIMIT = 32 << 20
BLOCK = 4096
# Level 6 with the filtered strategy: within 1% of level 9 on audio residuals, at a third of the time.
LEVEL = 6


def deflate(data):
    packer = zlib.compressobj(LEVEL, zlib.DEFLATED, -15, 9, zlib.Z_FILTERED)
    return packer.compress(data)+packer.flush()


def pcm_layout(data):
    """(head, frames, channels) for a plain 16-bit PCM WAV, otherwise None."""
    if len(data) < 12 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        return None
    at, fmt = 12, None
    while at+8 <= len(data):
        tag, size = data[at:at+4], struct.unpack_from('<I', data, at+4)[0]
        body = at+8
        if tag == b'fmt ' and size >= 16:
            fmt = struct.unpack_from('<HHIIHH', data, body)
        elif tag == b'data':
            if not fmt or fmt[0] != 1 or fmt[5] != 16 or not fmt[1] or fmt[4] != 2*fmt[1]:
                return None
            size = min(size, len(data)-body)
            frames = size//fmt[4]
            return (body, frames, fmt[1]) if frames else None
        at = body+size+(size & 1)
    return None


def wrap(values):
    return ((values+32768) & 0xffff)-32768


def residual(signal, order):
    """Residuals of signal (int32) for the fixed predictor of this order (0 to 3)."""
    if order == 0:
        return signal
    x = np.concatenate([np.zeros(3, np.int32), signal])
    a, b, c = x[2:-1], x[1:-2], x[:-3]
    return wrap(signal-(a, 2*a-b, 3*a-3*b+c)[order-1])


def encode_pcm16(data, head, frames, channels):
    pcm = np.frombuffer(data, '<i2', frames*channels, head).reshape(frames, channels).astype(np.int32)
    blocks = -(-frames//BLOCK)
    pad = blocks*BLOCK-frames
    choices = np.zeros((blocks, channels), np.uint8)
    planes = []
    for ch in range(channels):
        signals = [pcm[:, ch]]+([wrap(pcm[:, ch]-pcm[:, 0])] if ch else [])
        # Keeps, per block, the option whose residuals have the smallest summed magnitude.
        # Options are tried in choice order and a tie keeps the earlier one.
        best = np.full(blocks, np.inf)
        coded = np.zeros(blocks*BLOCK, np.int32)
        for side, signal in enumerate(signals):
            for order in range(4):
                r = np.pad(residual(signal, order), (0, pad))
                cost = np.abs(r).reshape(blocks, BLOCK).sum(1, dtype=np.int64)
                better = cost < best
                best[better] = cost[better]
                choices[better, ch] = 4*side+order
                mask = np.repeat(better, BLOCK)
                coded[mask] = r[mask]
        coded = coded[:frames]
        zig = ((coded << 1) ^ (coded >> 15)) & 0xffff
        planes += [(zig & 0xff).astype(np.uint8).tobytes(), (zig >> 8).astype(np.uint8).tobytes()]
    trailer = data[head+frames*channels*2:]
    payload = data[:head]+trailer+choices.tobytes()+b''.join(planes)
    return deflate(payload), {'head': head, 'frames': frames, 'channels': channels, 'block': BLOCK, 'trailer': len(trailer)}


def encode(name, data):
    """(codec, payload, extra header fields) for one file."""
    if name.endswith('.png'):
        return 'store', data, {}
    if name.endswith('.wav') and (layout := pcm_layout(data)):
        payload, extra = encode_pcm16(data, *layout)
        return 'pcm16', payload, extra
    return 'deflate', deflate(data), {}


def build_part(entries):
    header, offset = [], 0
    for name, data, codec, payload, extra in entries:
        header.append({'name': name, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data),
                       'codec': codec, 'offset': offset, 'length': len(payload), **extra})
        offset += len(payload)
    head = json.dumps({'version': 1, 'entries': header}, separators=(',', ':')).encode()
    return MAGIC+struct.pack('<I', len(head))+head+b''.join(e[3] for e in entries)


def pack(files, limit=PART_LIMIT):
    """files: {name: bytes}. Returns the parts (bytes), each at most limit unless one file is larger."""
    parts, current, size = [], [], 0
    for name in sorted(files):
        data = files[name]
        codec, payload, extra = encode(name, data)
        if current and size+len(payload) > limit:
            parts.append(build_part(current))
            current, size = [], 0
        current.append((name, data, codec, payload, extra))
        size += len(payload)
    if current:
        parts.append(build_part(current))
    return parts


if __name__ == '__main__':
    # python3 tools/devhost_pack.py <folder> <out>: packs every file in folder (used by the tests).
    import sys
    from pathlib import Path
    source, out = map(Path, sys.argv[1:3])
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else PART_LIMIT
    for i, part in enumerate(pack({p.name: p.read_bytes() for p in source.iterdir() if p.is_file()}, limit)):
        (out/f'part-{i}').write_bytes(part)
