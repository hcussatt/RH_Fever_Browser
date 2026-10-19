// Hot byte/sample loops run in the worker's JS engine, alongside the converter.
// Both algorithms keep the disc decoder's integer arithmetic and output bytes.
export function decodeDSP(raw,coefs,yn1,yn2,length){
 const result=new Int16Array(length);let sample=0;
 for(let frame=0;frame<raw.length;frame+=8){
  const ps=raw[frame],scale=1<<(ps&15),pred=ps>>>4;
  if(pred>=8)throw new Error('Invalid DSP predictor');
  const c0=coefs[pred*2],c1=coefs[pred*2+1];
  for(let i=0;i<14&&sample<length;i++){
   let nibble=(raw[frame+1+(i>>>1)]>>>(i%2===0?4:0))&15;
   if(nibble>=8)nibble-=16;
   // Use Number until after division: the predictor sum can exceed int32.
   const value=Math.max(-32768,Math.min(32767,Math.floor((c0*yn1+c1*yn2+nibble*scale*2048+1024)/2048)));
   result[sample++]=value;yn2=yn1;yn1=value;
  }
 }
 if(sample!==length)throw new Error('Incomplete DSP audio');
 return new Uint8Array(result.buffer);
}

export function decodeYaz0(data){
 if(data[0]!==89||data[1]!==97||data[2]!==122||data[3]!==48)return data;
 const size=new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(4),out=new Uint8Array(size);
 let pos=16,done=0;
 while(done<size){
  if(pos>=data.length)throw new Error('Incomplete Yaz0 data');
  const code=data[pos++];
  for(let bit=7;bit>=0&&done<size;bit--){
   if(code&(1<<bit)){
    if(pos>=data.length)throw new Error('Incomplete Yaz0 literal');
    out[done++]=data[pos++];
   }else{
    if(pos+2>data.length)throw new Error('Incomplete Yaz0 backreference');
    const a=data[pos++],b=data[pos++],distance=((a&15)<<8|b)+1;
    let count=a>>>4;
    if(!count){if(pos>=data.length)throw new Error('Incomplete Yaz0 length');count=data[pos++]+0x12;}else count+=2;
    if(distance>done||done+count>size)throw new Error('Invalid Yaz0 backreference');
    for(let i=0;i<count;i++){out[done]=out[done-distance];done++;}
   }
  }
 }
 return out;
}
