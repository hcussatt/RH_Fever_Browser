// NW4R's one-frame window: mirror its corner and clamp the outer rows/columns
// along the edges. Assemble pixels first so scaled quads cannot leave seams.
export function windowPixels(corner,width,height,fill){
 const out=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const dx=Math.min(x,width-1-x),dy=Math.min(y,height-1-y),at=(y*width+x)*4;
  if(dx<corner.width||dy<corner.height){
   const sx=Math.min(dx,corner.width-1),sy=Math.min(dy,corner.height-1),source=(sy*corner.width+sx)*4;
   out.set(corner.data.subarray(source,source+4),at);
  }else out.set(fill,at);
 }
 return out;
}
