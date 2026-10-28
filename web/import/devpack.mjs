// Unpacks the dev host's compressed parts (tools/devhost_pack.py describes the format). The caller
// checks every file against the manifest's SHA-256, so a decoding mistake can never reach the cache.
const MAGIC='RHFP';
async function inflate(bytes){
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
 return new Uint8Array(await new Response(stream).arrayBuffer());
}
// Rebuilds a 16-bit PCM WAV from its residuals (pcm16 in tools/devhost_pack.py).
export function decodePcm16(payload,{size,head,frames,channels,block,trailer}){
 const out=new Uint8Array(size),blocks=Math.ceil(frames/block);
 out.set(payload.subarray(0,head));
 let at=head+trailer;
 out.set(payload.subarray(head,at),head+frames*channels*2);
 const choices=payload.subarray(at,at+=blocks*channels);
 const samples=new DataView(out.buffer,head,frames*channels*2);
 const first=new Int16Array(frames);
 for(let ch=0;ch<channels;ch++){
  const lo=payload.subarray(at,at+frames),hi=payload.subarray(at+frames,at+2*frames);at+=2*frames;
  // Each channel keeps the history of both signals it may be coded as: itself and its difference from channel 0.
  const own=new Int16Array(frames),side=new Int16Array(frames);
  for(let b=0;b<blocks;b++){
   const choice=choices[b*channels+ch],order=choice&3,x=choice&4?side:own,end=Math.min(frames,(b+1)*block);
   for(let i=b*block;i<end;i++){
    const z=lo[i]|hi[i]<<8,r=(z>>>1)^-(z&1);
    const a=i>0?x[i-1]:0,p=i>1?x[i-2]:0,c=i>2?x[i-3]:0;
    const pred=order===0?0:order===1?a:order===2?2*a-p:3*a-3*p+c;
    x[i]=pred+r;// Int16Array wraps modulo 2**16, as the encoder did.
    if(x===side)own[i]=x[i]+first[i];else side[i]=x[i]-first[i];
   }
  }
  if(ch===0)first.set(own);
  for(let i=0;i<frames;i++)samples.setInt16(2*(i*channels+ch),own[i],true);
 }
 return out;
}
// Yields {name,sha256,data} for each file in one part.
export async function* unpack(part){
 const bytes=new Uint8Array(part);
 if(new TextDecoder().decode(bytes.subarray(0,4))!==MAGIC)throw new Error('Not a dev host part.');
 const length=new DataView(bytes.buffer,bytes.byteOffset).getUint32(4,true);
 const {version,entries}=JSON.parse(new TextDecoder().decode(bytes.subarray(8,8+length)));
 if(version!==1)throw new Error('This dev host part is from a newer upload tool. Reload the site.');
 const base=8+length;
 for(const entry of entries){
  const payload=bytes.subarray(base+entry.offset,base+entry.offset+entry.length);
  let data;
  if(entry.codec==='store')data=payload.slice();
  else if(entry.codec==='deflate')data=await inflate(payload);
  else if(entry.codec==='pcm16')data=decodePcm16(await inflate(payload),entry);
  else throw new Error('Unknown codec '+entry.codec+'. Reload the site.');
  yield {name:entry.name,sha256:entry.sha256,data};
 }
}
