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

from paths import BRSAR, DECOMP, DOL_SHA1, assets, game, require, source

GAME = game()
SOURCE = require(source(GAME))
OUT = assets(GAME)

# Per-game banks, sound IDs and BRSAR groups chosen by the original scene.
PROFILES = {
    'golf': {'banks': ['golfman', 'golf_bg', 'golf_bg_effect', 'golf_monkey'], 'sounds': [35]+list(range(758, 798)), 'groups': [98, 19]},
    'tap': {'banks': ['agb_tap', 'agb_tap_bg'], 'sounds': [157]+list(range(1250, 1262)), 'groups': [192, 57]},
}
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

def audio_groups(sound_ids=None,group_ids=None):
    b=require(BRSAR).read_bytes();base=u32(b,0x18)+8
    table=lambda off:base+u32(b,base+off+4)
    ref=lambda t,i:base+u32(b,t+8+i*8)
    sounds=table(0);groups=table(0x20)
    records={}
    names={int(i):n for n,i in re.findall(r'unsigned int (\w+) = (\d+);',(DECOMP/'build_default/SOME01/include/rev_tengoku.rsid').read_text()) if n.startswith(('SE_','WSD_'))}
    sound_ids=sound_ids or [35]+list(range(758,798))
    for sid in sound_ids:
        s=ref(sounds,sid);sub=base+u32(b,s+0x1c)
        records[sid]={'name':names.get(sid),'fileId':u32(b,s+4),'type':b[s+22],'volume':b[s+20],'player':u32(b,s+8),'data':list(struct.unpack_from('>4I',b,sub))}
    # Golf backing music and the original golf sound-effect bank/sequence group.
    files={}
    for gi in (group_ids or [98,19]):
        g=ref(groups,gi);items=base+u32(b,g+0x24)
        for i in range(u32(b,items)):
            item=ref(items,i);fid,off,size,woff,wsize=struct.unpack_from('>5I',b,item)
            metadata=b[u32(b,g+16)+off:u32(b,g+16)+off+size]
            wave_data=b[u32(b,g+24)+woff:u32(b,g+24)+woff+wsize]
            files[fid]={'magic':metadata[:4].decode('ascii'),'metadata':f'file-{fid}.bin','waves':f'wave-{fid}.bin' if wsize else None}
            (OUT/f'file-{fid}.bin').write_bytes(metadata)
            if wsize:(OUT/f'wave-{fid}.bin').write_bytes(wave_data)
    return {'sounds':records,'files':files}

if __name__=='__main__':
    profile=PROFILES[GAME]
    manifest={'textures':textures(),'banks':{n:bank(n) for n in profile['banks']},'audio':audio_groups(profile['sounds'],profile['groups'])}
    manifest['provenance']={'game':'Rhythm Heaven Fever SOME01','dolSha1':DOL_SHA1}
    (OUT/'original-assets.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    print(json.dumps({'banks':{n:{'cells':len(b['cells']),'animations':len(b['animations'])} for n,b in manifest['banks'].items()},'textures':manifest['textures'],'audioFiles':manifest['audio']['files']},indent=2))
