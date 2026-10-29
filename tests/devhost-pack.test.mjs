// The dev host's packed parts: tools/devhost_pack.py packs, web/import/devpack.mjs unpacks, and
// every file must come back byte-identical. Audio gets the hardest cases (wraparound extremes,
// stereo side coding, odd chunks, blocks that switch predictors).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {unpack} from '../web/import/devpack.mjs';
const python=process.env.RHF_PYTHON||'python3';
const sha=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');
// A WAV built by hand, so the test controls every chunk.
function wav(channels,samples,{bits=16,extra=[],odd=false,format=1}={}){
 const frames=samples.length/channels,data=Buffer.alloc(frames*channels*bits/8+(odd?1:0));
 samples.forEach((s,i)=>bits===16?data.writeInt16LE(s,2*i):data.writeUInt8(s&255,i));
 const fmt=Buffer.alloc(16);fmt.writeUInt16LE(format,0);fmt.writeUInt16LE(channels,2);fmt.writeUInt32LE(32000,4);fmt.writeUInt32LE(32000*channels*bits/8,8);fmt.writeUInt16LE(channels*bits/8,12);fmt.writeUInt16LE(bits,14);
 const chunk=(tag,body)=>Buffer.concat([Buffer.from(tag),Buffer.from(Uint32Array.of(body.length).buffer),body,body.length&1?Buffer.alloc(1):Buffer.alloc(0)]);
 const body=Buffer.concat([Buffer.from('WAVE'),chunk('fmt ',fmt),...extra.filter(e=>e.before).map(e=>chunk(e.tag,e.body)),chunk('data',data),...extra.filter(e=>!e.before).map(e=>chunk(e.tag,e.body))]);
 return Buffer.concat([Buffer.from('RIFF'),Buffer.from(Uint32Array.of(body.length).buffer),body]);
}
function random(seed){return ()=>{seed=(seed*1103515245+12345)>>>0;return seed/2**32;};}
function music(frames,channels,seed){
 const rnd=random(seed),out=[];
 for(let i=0;i<frames;i++){
  const t=i/32000,base=Math.sin(2*Math.PI*220*t)*9000+Math.sin(2*Math.PI*331*t)*5000*Math.exp(-(i%8000)/3000);
  for(let c=0;c<channels;c++)out.push(Math.max(-32768,Math.min(32767,Math.round(base*(c?.8:1)+(rnd()-.5)*120+(c?Math.sin(t*90)*900:0)))));
 }
 return out;
}
function pack(files,limit){
 const dir=mkdtempSync(join(tmpdir(),'rhf-pack-')),source=join(dir,'in'),out=join(dir,'out');
 mkdirSync(source);mkdirSync(out);
 try{
  for(const [name,data] of Object.entries(files))writeFileSync(join(source,name),data);
  execFileSync(python,['tools/devhost_pack.py',source,out,...(limit?[String(limit)]:[])],{stdio:['ignore','inherit','inherit']});
  return readdirSync(out).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(n=>readFileSync(join(out,n)));
 }finally{rmSync(dir,{recursive:true,force:true});}
}
async function roundTrip(files,limit){
 const parts=pack(files,limit),seen={},codecs={};
 for(const part of parts){
  const header=JSON.parse(part.subarray(8,8+part.readUInt32LE(4)).toString());
  for(const e of header.entries)codecs[e.name]=e.codec;
  for await(const {name,sha256,data} of unpack(part)){
   assert.equal(seen[name],undefined,name+' twice');seen[name]=true;
   assert.equal(sha256,await sha(files[name]),name+' hash in the header');
   assert.ok(Buffer.from(data).equals(files[name]),name+' must come back byte-identical');
  }
 }
 assert.deepEqual(Object.keys(seen).sort(),Object.keys(files).sort());
 return {parts,codecs};
}
let numpy=true;
try{execFileSync(python,['-c','import numpy'],{stdio:'ignore'});}catch{numpy=false;}
const skip=numpy?false:'needs Python with numpy (requirements.txt)';

test('16-bit WAVs come back byte-identical and much smaller',{skip},async()=>{
 const extremes=[];for(let i=0;i<9000;i++)extremes.push(i%3?32767:-32768,i%2?-32768:32767);
 const files={
  'music.wav':wav(2,music(70000,2,1)),
  'mono.wav':wav(1,music(20000,1,2)),
  'silence.wav':wav(2,new Array(2*5000).fill(0)),
  'extremes.wav':wav(2,extremes),
  'noise.wav':wav(1,Array.from({length:12000},(r=>()=>Math.floor(r()*65536)-32768)(random(3)))),
  'one-frame.wav':wav(2,[-32768,32767]),
  'chunks.wav':wav(2,music(5000,2,4),{extra:[{tag:'LIST',body:Buffer.from('INFOISFT\u0005\u0000\u0000\u0000rhfx\u0000',),before:true},{tag:'smpl',body:Buffer.alloc(36,7)}]}),
  'odd-data.wav':wav(1,music(3001,1,5),{odd:true}),
  // The second channel copies the first in the middle blocks only, so its coding switches to the
  // difference from channel 0 and back, which must carry each signal's history across the switch.
  'switching.wav':wav(2,music(4096*6,2,8).map((s,i,all)=>i&1&&i>2*4096*2&&i<2*4096*4?Math.max(-32768,Math.min(32767,all[i-1]+Math.round(6000*Math.sin(i/3000)))):i&1?Math.round(Math.sin(i/9)*20000):s)),
  'six-channels.wav':wav(6,music(4100*6,1,6).slice(0,4100*6)),
 };
 const {codecs}=await roundTrip(files);
 for(const name of Object.keys(files))assert.equal(codecs[name],'pcm16',name);
 const size=pack({'music.wav':files['music.wav']}).reduce((n,p)=>n+p.length,0);
 assert.ok(size<files['music.wav'].length*.6,`music packs to ${size} of ${files['music.wav'].length} bytes`);
});
test('other WAVs, PNGs, JSON and data use the general codecs and also round-trip',{skip},async()=>{
 const files={
  'eight-bit.wav':wav(1,music(3000,1,7).map(s=>s>>8),{bits:8}),
  'float.wav':wav(1,[1,2,3,4],{format:3}),
  'empty.wav':wav(2,[]),
  'broken.wav':Buffer.from('RIFF\u0010\u0000\u0000\u0000WAVEfmt '),
  'cover.png':Buffer.from([0x89,0x50,0x4e,0x47,1,2,3]),
  'menu.json':Buffer.from(JSON.stringify({title:'Hole in One',a:[1,2,3]})),
  'empty.json':Buffer.alloc(0),
  'data-80200000.bin':Buffer.from(Array.from({length:5000},(_,i)=>i*7&255)),
 };
 const {codecs}=await roundTrip(files);
 assert.equal(codecs['cover.png'],'store');
 for(const name of ['eight-bit.wav','float.wav','empty.wav','broken.wav','menu.json','data-80200000.bin'])assert.equal(codecs[name],'deflate',name);
});
test('parts split at the size limit, in name order, and the same files always pack the same',{skip},async()=>{
 const files={};for(let i=0;i<6;i++)files[`s${i}.wav`]=wav(1,music(30000,1,10+i));
 const {parts}=await roundTrip(files,40000);
 assert.ok(parts.length>1&&parts.length<=6,parts.length+' parts');
 const again=pack(files,40000);
 assert.deepEqual(again.map(p=>p.toString('hex')),parts.map(p=>p.toString('hex')));
});
