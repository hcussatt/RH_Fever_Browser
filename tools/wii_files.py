"""Read-only local Wii data-partition filesystem access for asset extraction."""
import functools
import os
import pathlib
import re
import struct
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = pathlib.Path(__file__).resolve().parents[1]
u32 = lambda b, o=0: struct.unpack_from('>I', b, o)[0]

KEY_FILE = ROOT/'local/wii-common-key.txt'


def common_key():
    """The Wii common key is not part of this repository. Supply it as 32 hex
    digits in $RHF_WII_COMMON_KEY or local/wii-common-key.txt, or point
    $RHF_DOLPHIN_IOSC at a Dolphin source checkout's Core/IOS/IOSC.cpp."""
    text = os.environ.get('RHF_WII_COMMON_KEY') or (KEY_FILE.read_text() if KEY_FILE.exists() else '')
    if not text and os.environ.get('RHF_DOLPHIN_IOSC'):
        iosc = pathlib.Path(os.environ['RHF_DOLPHIN_IOSC']).read_text()
        block = iosc.split('case ConsoleType::Retail:',1)[1].split('m_key_entries[HANDLE_COMMON_KEY]',1)[1].split('m_root_key_entry',1)[0]
        text = ''.join(re.findall(r'0x([0-9a-fA-F]{2})', block))
    text = re.sub(r'[^0-9a-fA-F]', '', text.replace('0x', '').replace('0X', ''))
    if len(text) != 32:
        raise SystemExit('Wii common key not found. See README.md, "Wii common key".')
    return bytes.fromhex(text)


class WiiFiles:
    def __init__(self, iso):
        self.source = pathlib.Path(iso).open('rb')
        if self.raw(0x18, 4) != bytes.fromhex('5d1c9ea3'):
            raise ValueError('Not a Wii disc')
        partitions = []
        for group in range(4):
            desc = self.raw(0x40000 + group * 8, 8)
            for entry in range(u32(desc)):
                item = self.raw(u32(desc, 4)*4 + entry*8, 8)
                if u32(item, 4) == 0:
                    partitions.append(u32(item)*4)
        if len(partitions) != 1:
            raise ValueError('Expected one game partition')
        meta = self.raw(partitions[0], 0x2c0)
        if meta[0x1f1] != 0:
            raise ValueError('Unsupported ticket key index')
        key = common_key()
        self.key = self.decrypt(key,meta[0x1dc:0x1e4]+bytes(8),meta[0x1bf:0x1cf])
        self.start = partitions[0] + u32(meta,0x2b8)*4
        boot = self.read(0,0x440)
        fst = self.read(u32(boot,0x424)*4,u32(boot,0x428)*4)
        count = u32(fst,8)
        strings = fst[count*12:]
        self.files = {}
        parents = [(count,'')]
        for i in range(1,count):
            while i >= parents[-1][0]:
                parents.pop()
            entry = fst[i*12:i*12+12]
            off = u32(entry)&0xffffff
            name = strings[off:strings.index(0,off)].decode('utf-8')
            if name in ('.','..') or '/' in name or '\\' in name:
                raise ValueError('Unsafe filesystem name')
            path = parents[-1][1] + name
            if entry[0]:
                parents.append((u32(entry,8),path+'/'))
            else:
                self.files[path] = (u32(entry,4)*4,u32(entry,8))

    def raw(self, offset, length):
        self.source.seek(offset)
        result = self.source.read(length)
        if len(result) != length:
            raise ValueError('Incomplete ISO')
        return result

    @staticmethod
    def decrypt(key,iv,data):
        d = Cipher(algorithms.AES(key),modes.CBC(iv)).decryptor()
        return d.update(data)+d.finalize()

    @functools.lru_cache(maxsize=32)
    def cluster(self,index):
        encrypted = self.raw(self.start+index*0x8000,0x8000)
        return self.decrypt(self.key,encrypted[0x3d0:0x3e0],encrypted[0x400:])

    def read(self,offset,length):
        out = bytearray()
        while length:
            block,inside = divmod(offset,0x7c00)
            n = min(length,0x7c00-inside)
            out.extend(self.cluster(block)[inside:inside+n])
            offset += n
            length -= n
        return bytes(out)

    def get(self,name):
        return self.read(*self.files[name])

    def dol(self):
        """The game executable from the data partition's boot header."""
        offset = u32(self.read(0,0x440),0x420)*4
        header = self.read(offset,0x100)
        size = max(u32(header,i*4)+u32(header,0x90+i*4) for i in range(18))
        return self.read(offset,size)

def yaz0(data):
    if data[:4] != b'Yaz0':
        return data
    size = u32(data,4)
    out = bytearray()
    pos = 16
    while len(out) < size:
        code = data[pos]; pos += 1
        for bit in range(7,-1,-1):
            if len(out) >= size:
                break
            if code & (1<<bit):
                out.append(data[pos]); pos += 1
            else:
                a,b = data[pos:pos+2]; pos += 2
                distance = ((a&15)<<8 | b)+1
                count = a>>4
                if not count:
                    count = data[pos]+0x12; pos += 1
                else:
                    count += 2
                if distance > len(out):
                    raise ValueError('Invalid Yaz0 backreference')
                for _ in range(count):
                    out.append(out[-distance])
    if len(out) != size:
        raise ValueError('Incorrect Yaz0 size')
    return bytes(out)

def u8_files(data):
    data = yaz0(data)
    if data[:4] != bytes.fromhex('55aa382d'):
        raise ValueError('Not a U8 archive')
    root = u32(data,4)
    count = u32(data,root+8)
    strings = root+count*12
    parents = [(count,'')]
    out = {}
    for i in range(1,count):
        while i >= parents[-1][0]:
            parents.pop()
        entry = data[root+i*12:root+i*12+12]
        off = strings+(u32(entry)&0xffffff)
        name = data[off:data.index(0,off)].decode('utf-8')
        if name == '.' and entry[0]:
            parents.append((u32(entry,8), parents[-1][1]))
            continue
        if name in ('.','..') or '/' in name or '\\' in name:
            raise ValueError('Unsafe archive name')
        path = parents[-1][1]+name
        if entry[0]:
            parents.append((u32(entry,8),path+'/'))
        else:
            start,length = u32(entry,4),u32(entry,8)
            if start+length > len(data):
                raise ValueError('Invalid archive extent')
            out[path] = data[start:start+length]
    return out
