#!/usr/bin/env python3
"""Convert one game's original textures, cell animations and sound groups from the
user's disc into browser assets. No hand-authored substitute assets."""
import hashlib
import json
import pathlib
import re
import struct
import sys
import numpy as np
from PIL import Image

from paths import BRSAR, DECOMP, DOL_SHA1, assets, game, manifest, require, source

GAME = game()
SOURCE = require(source(GAME))
OUT = assets(GAME)

# Cell-animation banks come from the manifest; sounds come from the chart (tools/chart-index.py).
PROFILE = manifest(GAME)['wii']
CHART = json.loads(require(OUT/'original-chart.json').read_text())
u16 = lambda b,o=0: struct.unpack_from('>H', b,o)[0]
u32 = lambda b,o=0: struct.unpack_from('>I', b,o)[0]

def textures():
    data = (SOURCE/'cellanim.tpl').read_bytes()
    assert u32(data) == 0x20af30
    paths = []
    for i in range(u32(data,4)):
        header = u32(data,u32(data,8)+i*8)
        h,w,fmt,start = struct.unpack_from('>HHII',data,header)
        assert fmt == 5, 'Expected RGB5A3 textures'
        words = np.frombuffer(data,dtype='>u2',count=w*h,offset=start).astype(np.uint16)
        words = words.reshape(h//4,w//4,4,4).transpose(0,2,1,3).reshape(h,w)
        opaque = (words&0x8000)!=0
        rgba = np.empty((h,w,4),dtype=np.uint8)
        for ch,shift in enumerate([10,5,0]):
            v=(words>>shift)&31
            rgba[:,:,ch] = np.where(opaque,(v<<3)|(v>>2),((words>>[8,4,0][ch])&15)*17)
        a=(words>>12)&7
        rgba[:,:,3] = np.where(opaque,255,(a<<5)|(a<<2)|(a>>1))
        name=f'texture-{i}.png'
        Image.fromarray(rgba,'RGBA').save(OUT/name)
        paths.append(name)
    return paths

def bank(name):
    data=(SOURCE/(name+'.brcad')).read_bytes()
    assert u32(data) == 20100312
    texture=u16(data,8)
    cell_count=u16(data,16)
    pos=20; cells=[]
    for _ in range(cell_count):
        count=u16(data,pos);pos+=4
        objects=[]
        for _ in range(count):
            v=struct.unpack_from('>6H2h3f4B',data,pos);pos+=32
            obj=dict(zip(('sx','sy','w','h','palette','reserved','x','y','scaleX','scaleY','angle','flipX','flipY','alpha','pad'),v))
            obj['x']-=512; obj['y']-=512
            objects.append(obj)
        cells.append(objects)
    count=u16(data,pos);pos+=4
    animations=[]
    for _ in range(count):
        key_count=u16(data,pos);pos+=4;keys=[]
        for _ in range(key_count):
            v=struct.unpack_from('>2H2h3fB3x',data,pos);pos+=24
            keys.append(dict(zip(('cell','frames','x','y','scaleX','scaleY','angle','alpha'),v)))
        animations.append(keys)
    assert pos == len(data), (name,pos,len(data))
    labels={n:int(i) for n,i in re.findall(r'#define\s+(\w+)\s+(\d+)',(SOURCE/('rcad_'+name+'_labels.h')).read_text(encoding='cp932'))}
    return {'texture':texture,'cells':cells,'animations':animations,'labels':labels}

def audio_groups():
    """The sound groups the game loads with its main chart, minus groups holding only other
    music (the tutorial's); every sound stored in those groups; and the chart's backing track."""
    b=require(BRSAR).read_bytes();base=u32(b,0x18)+8
    table=lambda off:base+u32(b,base+off+4)
    ref=lambda t,i:base+u32(b,t+8+i*8)
    sounds=table(0);groups=table(0x20)
    def items(gi):
        g=ref(groups,gi);items=base+u32(b,g+0x24)
        return g,[ref(items,i) for i in range(u32(b,items))]
    file_of=lambda sid:u32(b,ref(sounds,sid)+4)
    music_file=file_of(CHART['musicSound'])
    holds=lambda gi,fid:any(u32(b,item)==fid for item in items(gi)[1])
    loads=[l for l in CHART['groupLoads'] if any(holds(gi,music_file) for gi in l)]
    if not loads:raise SystemExit(f'{GAME}: no sound group load includes the music (file {music_file})')
    files={}
    for gi in dict.fromkeys(gi for l in loads for gi in l):
        g,group_items=items(gi);found={}
        for item in group_items:
            fid,off,size,woff,wsize=struct.unpack_from('>5I',b,item)
            metadata=b[u32(b,g+16)+off:u32(b,g+16)+off+size]
            found[fid]=(metadata,b[u32(b,g+24)+woff:u32(b,g+24)+woff+wsize])
        if music_file not in found and not any(m[:4] in (b'RBNK',b'RSEQ') for m,_ in found.values()):
            continue
        for fid,(metadata,wave_data) in found.items():
            files[fid]={'magic':metadata[:4].decode('ascii'),'metadata':f'file-{fid}.bin','waves':f'wave-{fid}.bin' if wave_data else None}
            (OUT/f'file-{fid}.bin').write_bytes(metadata)
            if wave_data:(OUT/f'wave-{fid}.bin').write_bytes(wave_data)
    names={int(i):n for n,i in re.findall(r'unsigned int (\w+) = (\d+);',(DECOMP/'build_default/SOME01/include/rev_tengoku.rsid').read_text()) if n.startswith(('SE_','WSD_'))}
    records={}
    for sid in range(u32(b,sounds)):
        if file_of(sid) not in files:continue
        s=ref(sounds,sid);sub=base+u32(b,s+0x1c)
        records[sid]={'name':names.get(sid),'fileId':file_of(sid),'type':b[s+22],'volume':b[s+20],'player':u32(b,s+8),'data':list(struct.unpack_from('>4I',b,sub))}
    return {'sounds':records,'files':files,'musicFile':music_file}

if __name__=='__main__':
    out={'textures':textures(),'banks':{n:bank(n) for n in PROFILE['banks']},'audio':audio_groups()}
    out['provenance']={'game':'Rhythm Heaven Fever SOME01','dolSha1':DOL_SHA1}
    (OUT/'original-assets.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
    print(json.dumps({'banks':{n:{'cells':len(b['cells']),'animations':len(b['animations'])} for n,b in out['banks'].items()},'textures':out['textures'],'audioFiles':out['audio']['files']},indent=2))
