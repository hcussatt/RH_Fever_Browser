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

from paths import DECOMP, DOL_SHA1, assets, game, manifest, read_sound_archive, require, source

GAME = game()
SOURCE = require(source(GAME))
OUT = assets(GAME)

# Cell-animation banks come from the manifest; sounds come from the chart (tools/chart-index.py).
PROFILE = manifest(GAME)['wii']
CHART = json.loads(require(OUT/'original-chart.json').read_text())
u16 = lambda b,o=0: struct.unpack_from('>H', b,o)[0]
u32 = lambda b,o=0: struct.unpack_from('>I', b,o)[0]

def rgb5a3(words):
    opaque = (words&0x8000)!=0
    rgba = np.empty(words.shape+(4,),dtype=np.uint8)
    for ch,shift in enumerate([10,5,0]):
        v=(words>>shift)&31
        rgba[...,ch] = np.where(opaque,(v<<3)|(v>>2),((words>>[8,4,0][ch])&15)*17)
    a=(words>>12)&7
    rgba[...,3] = np.where(opaque,255,(a<<5)|(a<<2)|(a>>1))
    return rgba

def rgb565(words):
    rgba = np.empty(words.shape+(4,),dtype=np.uint8)
    for ch,(shift,bits) in enumerate([(11,5),(5,6),(0,5)]):
        v=(words>>shift)&((1<<bits)-1)
        rgba[...,ch] = (v<<(8-bits))|(v>>(2*bits-8))
    rgba[...,3] = 255
    return rgba

def textures(prefix=''):
    data = (SOURCE/'cellanim.tpl').read_bytes()
    assert u32(data) == 0x20af30
    paths = []
    for i in range(u32(data,4)):
        header = u32(data,u32(data,8)+i*8)
        h,w,fmt,start = struct.unpack_from('>HHII',data,header)
        assert fmt in (5,6,9), f'Unsupported texture format {fmt}'
        name=f'{prefix}texture-{i}.png'
        # Tiles cover the texture padded to whole tiles (Power Calligraphy has 465x801); the
        # padding is decoded and cropped off.
        H,W=h,w
        h,w=-(-H//4)*4,-(-W//(8 if fmt==9 else 4))*(8 if fmt==9 else 4)
        if fmt == 9:
            # C8: 8x4 tiles of palette indices into the texture's palette (RGB565 or RGB5A3).
            palette_header = u32(data,u32(data,8)+i*8+4)
            count,_,palette_format,palette_start = struct.unpack_from('>HBxII',data,palette_header)
            assert palette_format in (1,2), f'Unsupported palette format {palette_format}'
            indices = np.frombuffer(data,dtype=np.uint8,count=w*h,offset=start)
            indices = indices.reshape(h//4,w//8,4,8).transpose(0,2,1,3).reshape(h,w)
            words = np.frombuffer(data,dtype='>u2',count=count,offset=palette_start).astype(np.uint16)
            colors = rgb565(words) if palette_format == 1 else rgb5a3(words)
            Image.fromarray(colors[indices][:H,:W],'RGBA').save(OUT/name)
            paths.append(name)
            continue
        if fmt == 6:
            # RGBA8: 4x4 tiles of 64 bytes, alpha/red pairs then green/blue pairs.
            tiles = np.frombuffer(data,dtype=np.uint8,count=w*h*4,offset=start).reshape(h//4,w//4,2,16,2)
            rgba = np.empty((h//4,w//4,16,4),dtype=np.uint8)
            rgba[...,3],rgba[...,0] = tiles[:,:,0,:,0],tiles[:,:,0,:,1]
            rgba[...,1],rgba[...,2] = tiles[:,:,1,:,0],tiles[:,:,1,:,1]
            rgba = rgba.reshape(h//4,w//4,4,4,4).transpose(0,2,1,3,4).reshape(h,w,4)
            Image.fromarray(rgba[:H,:W],'RGBA').save(OUT/name)
            paths.append(name)
            continue
        words = np.frombuffer(data,dtype='>u2',count=w*h,offset=start).astype(np.uint16)
        words = words.reshape(h//4,w//4,4,4).transpose(0,2,1,3).reshape(h,w)
        Image.fromarray(rgb5a3(words)[:H,:W],'RGBA').save(OUT/name)
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
    """The system sound group, the sound groups the game loads with its main chart (minus groups
    holding only other music, the tutorial's), every sound stored in those groups, and the
    chart's backing track."""
    header=read_sound_archive(0,0x28)
    # All references below are in INFO. Audio payloads live much farther into
    # the archive: leave unrelated games on disc instead of copying 319 MB.
    b=read_sound_archive(0,u32(header,0x18)+u32(header,0x1c));base=u32(b,0x18)+8
    table=lambda off:base+u32(b,base+off+4)
    ref=lambda t,i:base+u32(b,t+8+i*8)
    sounds=table(0);banks=table(8);groups=table(0x20)
    def items(gi):
        g=ref(groups,gi);items=base+u32(b,g+0x24)
        return g,[ref(items,i) for i in range(u32(b,items))]
    file_of=lambda sid:u32(b,ref(sounds,sid)+4)
    music_file=file_of(CHART['musicSound'])
    # The practice's backing waves (tools/chart-index.py), in groups the same loads bring in.
    practice_files={file_of(w) for w in CHART.get('practice',{}).get('waves',[])}
    holds=lambda gi,fid:any(u32(b,item)==fid for item in items(gi)[1])
    loads=[l for l in CHART['groupLoads'] if any(holds(gi,music_file) for gi in l)]
    if not loads:raise SystemExit(f'{GAME}: no sound group load includes the music (file {music_file})')
    files={}
    # Group 0 is the system set every minigame shares (SE_MISS and the other common sounds).
    # GROUP_RESULT (162), loaded by the original grading chart lbl_801F97A0.
    for gi in dict.fromkeys([0,162,163]+[gi for l in loads for gi in l]):
        g,group_items=items(gi);found={}
        for item in group_items:
            fid,off,size,woff,wsize=struct.unpack_from('>5I',b,item)
            metadata=read_sound_archive(u32(b,g+16)+off,size)
            found[fid]=(metadata,read_sound_archive(u32(b,g+24)+woff,wsize) if wsize else b'')
        if gi not in (162,163) and music_file not in found and not practice_files&found.keys() and not any(m[:4] in (b'RBNK',b'RSEQ') for m,_ in found.values()):
            continue
        for fid,(metadata,wave_data) in found.items():
            persistent=gi==0 or files.get(fid,{}).get('persistent',False)
            files[fid]={'magic':metadata[:4].decode('ascii'),'metadata':f'file-{fid}.bin','waves':f'wave-{fid}.bin' if wave_data else None,'persistent':persistent}
            (OUT/f'file-{fid}.bin').write_bytes(metadata)
            if wave_data:(OUT/f'wave-{fid}.bin').write_bytes(wave_data)
    labels=DECOMP/'build_default/SOME01/include/rev_tengoku.rsid'
    names={int(i):n for n,i in re.findall(r'unsigned int (\w+) = (\d+);',labels.read_text()) if n.startswith(('SE_','WSD_'))} if labels.exists() else {int(i):n for i,n in PROFILE.get('soundNames',{}).items()}
    records={}
    for sid in range(u32(b,sounds)):
        if file_of(sid) not in files:continue
        s=ref(sounds,sid);sub=base+u32(b,s+0x1c)
        records[sid]={'name':names.get(sid),'fileId':file_of(sid),'type':b[s+22],'volume':b[s+20],'player':u32(b,s+8),'data':list(struct.unpack_from('>4I',b,sub)),'persistent':files[file_of(sid)]['persistent']}
        # A sequence sound plays its notes with the instruments of one bank (SeqSoundInfo bankId).
        if records[sid]['type']==1:
            records[sid]['bankFile']=u32(b,ref(banks,records[sid]['data'][1])+4)
            records[sid]['persistent'] &= files.get(records[sid]['bankFile'],{}).get('persistent',False)
    missing=practice_files-files.keys()
    if missing:raise SystemExit(f'{GAME}: practice wave files {sorted(missing)} are in no group the game loads')
    return {'sounds':records,'files':files,'musicFile':music_file}

def remix():
    """A remix's scenes each load their own archive (the remix version of each game's graphics).
    Every bank in it is kept, since a scene's version picks which ones it registers; textures are
    numbered across all scenes."""
    global SOURCE
    out={'textures':[],'banks':{},'scenes':[]}
    for scene in PROFILE['scenes']:
        folder=require(source(GAME)/scene['game']);names=[]
        # A scene that also loads another game's archive has it in a folder inside its own.
        for SOURCE in [folder]+[require(folder/path.split('/')[-3]) for path in manifest(scene['game'])['wii'].get('extraCellanims',[])]:
            first=len(out['textures']);out['textures']+=textures(scene['game']+'-'+('' if SOURCE==folder else SOURCE.name+'-'))
            for n in sorted(p.stem for p in SOURCE.glob('*.brcad')):
                b=bank(n);b['texture']+=first;out['banks'][scene['game']+'/'+n]=b;names.append(n)
        out['scenes'].append({'game':scene['game'],'banks':names})
    return out

def single():
    """A game's own archive, and any other game's it also loads (the calibration's metronome) from a
    folder inside its own; textures are numbered across them."""
    global SOURCE
    main=SOURCE;out={'textures':[],'banks':{}}
    for SOURCE in [main]+[require(main/path.split('/')[-3]) for path in PROFILE.get('extraCellanims',[])]:
        first=len(out['textures']);out['textures']+=textures('' if SOURCE==main else SOURCE.name+'-')
        for n in PROFILE['banks']:
            if (SOURCE/(n+'.brcad')).exists():
                out['banks'][n]=bank(n);out['banks'][n]['texture']+=first
    out['banks']={n:out['banks'][n] for n in PROFILE['banks']}
    SOURCE=main
    return out

if __name__=='__main__':
    out=remix() if 'scenes' in PROFILE else single()
    out['audio']=audio_groups()
    out['provenance']={'game':'Rhythm Heaven Fever SOME01','dolSha1':DOL_SHA1}
    (OUT/'original-assets.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
    print(json.dumps({'banks':{n:{'cells':len(b['cells']),'animations':len(b['animations'])} for n,b in out['banks'].items()},'textures':out['textures'],'audioFiles':out['audio']['files']},indent=2))
