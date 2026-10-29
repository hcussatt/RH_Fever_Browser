"""Read-only access to a decrypted Rhythm Heaven Megamix dump (3DS) for extraction.

Takes a decrypted .cia or .3ds/.cci (GodMode9 "Decrypt file"). Encrypted dumps are refused
with a pointer to that step: this repository never handles 3DS console keys.
"""
import pathlib
import struct

MEDIA = 0x200
MEGAMIX_USA = 0x000400000018A400
u16 = lambda b, o=0: struct.unpack_from('<H', b, o)[0]
u32 = lambda b, o=0: struct.unpack_from('<I', b, o)[0]
u64 = lambda b, o=0: struct.unpack_from('<Q', b, o)[0]
align = lambda x, a: (x + a - 1) & -a
NONE = 0xFFFFFFFF


class Encrypted(ValueError):
    pass


def blz_decompress(data):
    """Bottom-up LZ77 used for the 3DS code binary: decompressed backwards from its footer."""
    top_bottom, grow = struct.unpack_from('<II', data, len(data)-8)
    top, bottom = top_bottom & 0xFFFFFF, top_bottom >> 24
    out = bytearray(data) + bytearray(grow)
    src, dst, end = len(data)-bottom, len(out), len(data)-top
    while src > end:
        src -= 1
        flags = out[src]
        for _ in range(8):
            if src <= end:
                break
            if flags & 0x80:
                src -= 2
                pair = out[src] | out[src+1] << 8
                disp = (pair & 0xFFF) + 3
                for _ in range((pair >> 12) + 3):
                    dst -= 1
                    out[dst] = out[dst+disp]
            else:
                src -= 1
                dst -= 1
                out[dst] = out[src]
            flags <<= 1
    return bytes(out)


class CtrFiles:
    """The main program (NCCH) of a decrypted CIA or CCI: code segments and RomFS files."""

    def __init__(self, path):
        self.source = pathlib.Path(path).open('rb')
        head = self.raw(0, 0x200)
        if head[0x100:0x104] == b'NCSD':
            self.base = u32(head, 0x120) * MEDIA
        elif u32(head) == 0x2020:
            self.base = self.cia_content()
        else:
            raise ValueError('Not a CIA or a 3DS cartridge image')
        ncch = self.raw(self.base, 0x200)
        if ncch[0x100:0x104] != b'NCCH':
            raise Encrypted('The program is encrypted. Decrypt the dump on your 3DS first '
                            '(GodMode9: the file\'s options, "Decrypt file").')
        if not ncch[0x18F] & 4:
            raise Encrypted('The program is encrypted (NCCH crypto flag set). Decrypt the dump on your '
                            '3DS first (GodMode9: the file\'s options, "Decrypt file").')
        self.title = u64(ncch, 0x118)
        self.exheader = self.raw(self.base + 0x200, 0x400)
        self.exefs = self.base + u32(ncch, 0x1A0) * MEDIA
        self.romfs = self.base + u32(ncch, 0x1B0) * MEDIA if u32(ncch, 0x1B4) else None
        self.files = self.read_romfs() if self.romfs is not None else {}

    def raw(self, offset, length):
        self.source.seek(offset)
        data = self.source.read(length)
        if len(data) != length:
            raise ValueError('Truncated dump')
        return data

    def cia_content(self):
        head = self.raw(0, 0x20)
        cert, ticket, tmd = u32(head, 8), u32(head, 12), u32(head, 16)
        tmd_at = align(0x2020, 64) + align(cert, 64) + align(ticket, 64)
        content_at = tmd_at + align(tmd, 64)
        sig = struct.unpack('>I', self.raw(tmd_at, 4))[0]
        body = tmd_at + 4 + {0x10003: 0x23C, 0x10004: 0x13C, 0x10005: 0x7C}[sig]
        count = struct.unpack('>H', self.raw(body + 0x9E, 2))[0]
        records = self.raw(body + 0xC4 + 64*0x24, count*0x30)
        if struct.unpack('>H', records[6:8])[0] & 1:
            raise Encrypted('The CIA is still encrypted. Decrypt it on your 3DS first '
                            '(GodMode9: CIA image options, "Decrypt file (SD)").')
        return content_at   # content 0 is the main program

    def exefs_file(self, name):
        head = self.raw(self.exefs, 0x200)
        for i in range(10):
            entry = head[i*16:i*16+16]
            if entry[:8].rstrip(b'\0').decode() == name:
                return self.raw(self.exefs + 0x200 + u32(entry, 8), u32(entry, 12))
        raise KeyError(name)

    def code(self):
        """The program's text, rodata and data segments, decompressed, with their load addresses."""
        data = self.exefs_file('.code')
        if self.exheader[0xD] & 1:
            data = blz_decompress(data)
        segments = {}
        offset = 0
        for name, at in (('text', 0x10), ('rodata', 0x20), ('data', 0x30)):
            address, pages, size = struct.unpack_from('<III', self.exheader, at)
            segments[name] = (address, data[offset:offset+size])
            offset += pages * 0x1000
        segments['bss'] = u32(self.exheader, 0x3C)
        return segments

    def read_romfs(self):
        ivfc = self.raw(self.romfs, 0x60)
        if ivfc[:4] != b'IVFC':
            raise ValueError('Bad RomFS')
        level3 = self.romfs + align(0x60 + u32(ivfc, 8), 1 << u32(ivfc, 0x4C))
        head = self.raw(level3, 0x28)
        dirs = self.raw(level3 + u32(head, 0x0C), u32(head, 0x10))
        metas = self.raw(level3 + u32(head, 0x1C), u32(head, 0x20))
        data = level3 + u32(head, 0x24)
        files = {}

        def walk(offset, prefix):
            child, first = u32(dirs, offset + 8), u32(dirs, offset + 12)
            while first != NONE:
                size = u32(metas, first + 0x1C)
                name = metas[first+0x20:first+0x20+size].decode('utf-16-le')
                files[prefix + name] = (data + u64(metas, first + 8), u64(metas, first + 16))
                first = u32(metas, first + 4)
            while child != NONE:
                size = u32(dirs, child + 0x14)
                walk(child, prefix + dirs[child+0x18:child+0x18+size].decode('utf-16-le') + '/')
                child = u32(dirs, child + 4)

        walk(0, '')
        return files

    def read(self, name):
        offset, size = self.files[name]
        return self.raw(offset, size)
