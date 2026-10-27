#!/usr/bin/env python3
"""Extract the original grading layout, comments, criteria and result music.
All outputs are private disc-derived data under dist/, never tracked source.
"""
import importlib.util
import json
import re
import tempfile
from pathlib import Path
from paths import DISC, DOL, DECOMP, assets, game, manifest, require
from nintendo_audio import wave_files, decode_wave, write_wav

def module(name, file):
    spec=importlib.util.spec_from_file_location(name,file)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

layout=module('extract_layout','tools/extract-layout.py')
chart=module('chart_index','tools/chart-index.py')
out=assets(game());root=require(DISC/'results/layout')
data=layout.layout((root/'blyt/grading.brlyt').read_bytes())
data['animations']={p.stem:layout.animation(p.read_bytes()) for p in sorted((root/'anim').glob('*.brlan'))}
data['images']={}
for p in sorted((root/'timg').glob('*.tpl')):
    name='results-'+p.name+'.png';layout.tpl(p.read_bytes()).save(out/name);data['images'][p.name]=name
comments=layout.messages(require(DISC/'message/riq_comment_E.bmg').read_bytes())
chars={ord(c) for t in comments.values() for c in t if c!='\n'}|set(range(32,127))
data['font'],atlas=layout.font(require(DISC/'font'/data['fonts'][0]).read_bytes(),chars)
atlas.save(out/'results-font.png')
(out/'results-layout.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
main=json.loads((out/'original-chart.json').read_text())
cmds=list(chart.commands(main['start']))
string=lambda a:chart.read(a,128).split(b'\0')[0].decode('ascii')
# The rhythm test grades nothing (no criteria).
criteria=next((args[0] for _,op,arg,args in cmds if op==0x118 and arg==1),None)
# A game with no results (Night Walk ends on the staff credits) has no caption, epilogue or result music.
RESULTS=manifest(game())['wii'].get('results',True)
caption=next(string(args[0]) for _,op,arg,args in cmds if op==0x108) if RESULTS else None
# CMessageManager::fn_80088088 uses these original IDs for the joining strings.
text={0:''};text.update(comments)
metadata={'messages':text,'caption':text[int(caption)] if RESULTS else None,'criteria':criteria,'flow':0x801f97e0,'waves':{}}
if RESULTS:
    ep_messages={arg:text[int(string(args[0]))] for _,op,arg,args in cmds if op==0x107}
    metadata['epilogueMessages']=[ep_messages[i] for i in (0,1,2)]
extract=module('extract_assets','tools/extract-assets.py')
if RESULTS:
    ep=layout.layout(require(DISC/'epilogue/layout/blyt/epilogue.brlyt').read_bytes())
    ep['animations']={};ep['images']={};ep['font']=data['font']
    for p in sorted((DISC/'epilogue/layout/timg').glob('*.tpl')):
        name='epilogue-'+p.name+'.png';layout.tpl(p.read_bytes()).save(out/name);ep['images'][p.name]=name
    (out/'epilogue-layout.json').write_text(json.dumps(ep,separators=(',',':'))+'\n')
    extract.SOURCE=DISC/game()/'epilogue'
    with tempfile.TemporaryDirectory() as tmp:
        extract.OUT=Path(tmp);textures=extract.textures();bank=extract.bank('epilogue')
        for name in textures:(out/('epilogue-'+name)).write_bytes((Path(tmp)/name).read_bytes())
    (out/'epilogue.json').write_text(json.dumps({'textures':['epilogue-'+n for n in textures],'bank':bank},separators=(',',':'))+'\n')
extract.SOURCE=DISC/'permanent'
with tempfile.TemporaryDirectory() as tmp:
    extract.OUT=Path(tmp);textures=extract.textures();bank=extract.bank('permanent')
    # The whole permanent bank, for the cell animations CExScene::_08 makes from it that the port
    # draws: the "you" markers (permanent_you, _you_1P, _you_2P) over the player's character and the
    # screen mask (permanent_mask) a chart can tint and fade.
    if len(textures)!=1:raise ValueError('permanent cellanim: expected one texture')
    metadata['permanent']={'textures':['results-prompt.png'],'bank':{**bank,'texture':0},
                           'you':[bank['labels'][n] for n in ('permanent_you','permanent_you_1P','permanent_you_2P')],
                           'mask':bank['labels']['permanent_mask']}
    # The two original A/Next animations reference only cells 0 and 1.
    bank['animations']=bank['animations'][:2];bank['cells']=bank['cells'][:2]
    bank['labels']={k:v for k,v in bank['labels'].items() if v<2}
    texture=textures[bank['texture']];name='results-prompt.png'
    (out/name).write_bytes((Path(tmp)/texture).read_bytes());bank['texture']=0
    metadata['prompt']={'textures':[name],'bank':bank}
# Remix 8's photo frame (remix08_Mask), for a chart that shows it with CExFlow 0x13f.
if any(op==0x13f for _,op,_,_ in cmds):
    extract.SOURCE=require(DISC/'remix-mask')
    with tempfile.TemporaryDirectory() as tmp:
        extract.OUT=Path(tmp);textures=extract.textures();bank=extract.bank('remix08_Mask')
        if len(textures)!=1:raise ValueError('remix08_Mask: expected one texture')
        name='remix-mask.png';(out/name).write_bytes((Path(tmp)/textures[0]).read_bytes())
    metadata['remixMask']={'textures':[name],'bank':{**bank,'texture':0}}
audio=json.loads((out/'original-assets.json').read_text())['audio']
for sid,s in audio['sounds'].items():
    if not (s.get('name') or '').startswith(('WSD_RESULT_','WSD_EPILOGUE_')):
        continue
    file=audio['files'][str(s['fileId'])];waves=list(wave_files((out/file['waves']).read_bytes()))
    wsd=(out/file['metadata']).read_bytes();base=layout.u32(wsd,16)+8
    entry=base+layout.u32(wsd,base+8+s['data'][0]*8)
    table=base+layout.u32(wsd,entry+20)
    if layout.u32(wsd,table)!=1:raise ValueError('Multi-note WSD is not implemented')
    note=base+layout.u32(wsd,table+8)
    wave_index=layout.u32(wsd,note)
    pcm,info=decode_wave(waves[wave_index]);name=f'results-music-{sid}.wav';write_wav(out/name,pcm,info['rate'])
    metadata['waves'][sid]={'file':name,'volume':s['volume'],**info}
if RESULTS and len(metadata['waves'])!=6:raise ValueError('Missing result/epilogue music')
(out/'results.json').write_text(json.dumps(metadata,separators=(',',':'))+'\n')
print(f'{game()}: original grading layout ({len(data["panes"])} panes), comments, epilogue and 6 music tracks')
