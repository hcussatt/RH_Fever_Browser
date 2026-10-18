export async function createRenderer(g,canvas){
 const images=await Promise.all(g.assets.textures.map(async n=>{const i=new Image();i.src=new URL('assets/'+n,import.meta.url);await i.decode();return i;}));
 const ctx=canvas.getContext('2d',{alpha:false});
 const {u8,u16,u32,f32,core,banks}=g;
 const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
 const trs=(x,y,deg,sx,sy)=>{const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*sx,s*sx,-s*sy,c*sy,x,y];};
 let states;
 function state(a){
  if(states.has(a))return states.get(a);
  const bank=banks[u8(a+12)],anim=u16(a+14),frame=f32(a+0x44);
  const keys=bank.animations[anim];let k=keys.at(-1),sum=0;for(const v of keys){sum+=v.frames;if(sum>frame){k=v;break;}}
  let m=trs(f32(a+0x84),f32(a+0x88),f32(a+0x94),f32(a+0x8c),f32(a+0x90));
  m=mul(m,trs(k.x,k.y,k.angle,k.scaleX,k.scaleY));
  const parent=u32(a+0xb0);
  if(parent){const p=state(parent),o=p.objects[u16(a+0xc0)];let pm=p.m;if(o)pm=mul(pm,trs(o.x+o.w*o.scaleX/2,o.y+o.h*o.scaleY/2,o.angle,o.scaleX,o.scaleY));m=mul(pm,m);}
  const out={m,k,objects:bank.cells[k.cell],bank,enabled:!!u8(a+0xa7),opacity:u8(a+0xa6)};states.set(a,out);return out;
 }
 function draw(){
  states=new Map();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  const pool=core.HEAPU32.subarray(core._pool_ptr()/4,core._pool_ptr()/4+core._pool_count()),active=core.HEAPU32.subarray(core._active_ptr()/4,core._active_ptr()/4+core._pool_count());
  const actors=Array.from(pool).filter((a,i)=>active[i]&&u8(a+12)!==255&&u8(a+0xa7)).sort((a,b)=>(u32(b+0x98)|0)-(u32(a+0x98)|0));
  // Original wide projection: x +/-416, y +/-228 (CellAnimManager::setupProj).
  const origin=[canvas.width/832,0,0,canvas.height/456,canvas.width/2,canvas.height/2];
  for(const a of actors){const s=state(a);ctx.imageSmoothingEnabled=!!u8(a+0xa8);
   for(const o of s.objects){const alpha=Math.floor(s.k.alpha*o.alpha*s.opacity/255/255)/255;if(!alpha||!o.w||!o.h)continue;
    let m=mul(origin,s.m);m=mul(m,trs(o.x+o.w*o.scaleX/2,o.y+o.h*o.scaleY/2,o.angle,o.scaleX*(o.flipX?-1:1),o.scaleY*(o.flipY?-1:1)));
    ctx.setTransform(...m);ctx.globalAlpha=alpha;ctx.drawImage(images[s.bank.texture],o.sx,o.sy,o.w,o.h,-o.w/2,-o.h/2,o.w,o.h);
   }
  }
  ctx.globalAlpha=1;
 }
 return {draw,state};
}
