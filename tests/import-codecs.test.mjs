import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeDSP,decodeYaz0} from '../web/import/codecs.mjs';

test('DSP matches an independent wide-integer reference, including overflow and clipping',()=>{
 let seed=7123;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 const raw=new Uint8Array(8*200),coefs=Array.from({length:16},()=>random()%65536-32768);
 for(let frame=0;frame<200;frame++){
  raw[frame*8]=(random()%8)*16+random()%16;
  for(let i=1;i<8;i++)raw[frame*8+i]=random()%256;
 }
 for(const length of [1,13,14,15,2799,2800]){
  let h1=-32768n,h2=32767n;const expected=[];
  for(let i=0;i<length;i++){
   const frame=Math.floor(i/14)*8,j=i%14,ps=raw[frame];
   let nibble=(raw[frame+1+Math.floor(j/2)]>>(j%2?0:4))&15;if(nibble>=8)nibble-=16;
   let v=(BigInt(coefs[(ps>>4)*2])*h1+BigInt(coefs[(ps>>4)*2+1])*h2+BigInt(nibble)*(1n<<BigInt(ps&15))*2048n+1024n)>>11n;
   v=v>32767n?32767n:v< -32768n?-32768n:v;
   expected.push(Number(v));h2=h1;h1=v;
  }
  const result=decodeDSP(raw,coefs,-32768,32767,length);
  assert.deepEqual([...new Int16Array(result.buffer)],expected);
 }
 assert.throws(()=>decodeDSP(new Uint8Array([128,0,0,0,0,0,0,0]),coefs,0,0,1),/predictor/);
 assert.throws(()=>decodeDSP(new Uint8Array(),coefs,0,0,1),/Incomplete/);
});

test('Yaz0 preserves raw files, literals, and overlapping short/long backreferences',()=>{
 const archive=(size,payload)=>{
  const out=new Uint8Array(16+payload.length);out.set([89,97,122,48]);new DataView(out.buffer).setUint32(4,size);out.set(payload,16);return out;
 };
 const raw=new Uint8Array([1,2,3]);assert.equal(decodeYaz0(raw),raw);
 assert.deepEqual([...decodeYaz0(archive(6,[0xe0,65,66,67,0x10,2]))],[65,66,67,65,66,67]);
 assert.deepEqual([...decodeYaz0(archive(20,[0x80,65,0,0,1]))],Array(20).fill(65));
 assert.throws(()=>decodeYaz0(archive(1,[])),/Incomplete/);
 assert.throws(()=>decodeYaz0(archive(3,[0,0x10,0])),/Invalid/);
});
