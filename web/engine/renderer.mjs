// Draws the original cell animations the way CCellAnim::makeMtx and CCellAnim::draw do
// (src/GameUtil/CellAnim.cpp): every frame the matrices are rebuilt from the root animations
// down, and an animation attached to an object of its base only moves while the base's
// current cell has that object; otherwise it keeps its last matrix. An attached animation
// drawn with its base (mBaseAnimDraw) is drawn right after that object, not by layer.
// A game's 2D layout (layout.mjs) is drawn over the cell animations.
import {createLayout} from './layout.mjs';
import {assetImage} from './assets.mjs';
export async function createRenderer(g,canvas){
 const images=await Promise.all(g.assets.textures.map(n=>assetImage(new URL('assets/'+n,g.base))));
 const ctx=canvas.getContext('2d',{alpha:false});
 const layout=await createLayout(g);
 const {u8,u16,u32,f32,core,banks}=g;
 const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
 const trs=(x,y,deg,sx,sy)=>{const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*sx,s*sx,-s*sy,c*sy,x,y];};
 const identity=[1,0,0,1,0,0];
 // CCellAnim fields: mBaseAnim +0xb0, mBaseLinkedHead +0xb4, mBaseLinkedNext +0xb8,
 // mBaseOBJIndex +0xc0, mBaseAnimDraw +0xc2.
 const matrices=new Map();// mMtx, kept across frames like the original's
 let current;
 function key(a){
  const keys=banks[u8(a+12)].animations[u16(a+14)],frame=f32(a+0x44);
  let sum=0;for(const k of keys){sum+=k.frames;if(sum>frame)return k;}return keys.at(-1);
 }
 const cell=a=>banks[u8(a+12)].cells[key(a).cell];
 const children=a=>{const out=[];for(let c=u32(a+0xb4),n=0;c&&n<256;c=u32(c+0xb8),n++)out.push(c);return out;};
 function makeMatrix(a,base){
  const k=key(a);
  let m=mul(base,trs(f32(a+0x84),f32(a+0x88),f32(a+0x94),f32(a+0x8c),f32(a+0x90)));
  m=mul(m,trs(k.x,k.y,k.angle,k.scaleX,k.scaleY));
  matrices.set(a,m);
  const attached=children(a);if(!attached.length)return;
  // A placeholder has no cells to anchor on: its attachments follow its own matrix.
  if(u8(a+12)===255){for(const c of attached)makeMatrix(c,m);return;}
  cell(a).forEach((o,i)=>{
   const here=attached.filter(c=>u16(c+0xc0)===i);if(!here.length)return;
   const om=mul(m,trs(o.x+o.w*o.scaleX/2,o.y+o.h*o.scaleY/2,o.angle,o.scaleX,o.scaleY));
   for(const c of here)makeMatrix(c,om);
  });
 }
 function drawActor(a,origin){
  const k=key(a),m=matrices.get(a);if(!m)return;
  const bank=banks[u8(a+12)],opacity=u8(a+0xa6),attached=children(a).filter(c=>u8(c+0xc2)&&u8(c+0xa7)&&current.has(c));
  cell(a).forEach((o,i)=>{
   const alpha=Math.floor(k.alpha*o.alpha*opacity/255/255)/255;
   if(alpha&&o.w&&o.h){
    ctx.imageSmoothingEnabled=!!u8(a+0xa8);
    const om=mul(mul(origin,m),trs(o.x+o.w*o.scaleX/2,o.y+o.h*o.scaleY/2,o.angle,o.scaleX*(o.flipX?-1:1),o.scaleY*(o.flipY?-1:1)));
    ctx.setTransform(...om);ctx.globalAlpha=alpha;ctx.drawImage(images[bank.texture],o.sx,o.sy,o.w,o.h,-o.w/2,-o.h/2,o.w,o.h);
   }
   for(const c of attached)if(u16(c+0xc0)===i&&u8(c+12)!==255)drawActor(c,origin);
  });
 }
 function draw(){
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  // Between a remix's scenes nothing draws, and the fader covers the screen while it waits
  // (CScene::fn_801D8554, CFaderFlash::_0C).
  if(core._screen_state()!==1)return;
  const pool=core.HEAPU32.subarray(core._pool_ptr()/4,core._pool_ptr()/4+core._pool_count()),active=core.HEAPU32.subarray(core._active_ptr()/4,core._active_ptr()/4+core._pool_count());
  // Bank 255 stands in for the platform's own placeholder animations: never drawn, but
  // they can be bases for others.
  const actors=Array.from(pool).filter((a,i)=>active[i]);
  current=new Set(actors);
  for(const a of matrices.keys())if(!current.has(a))matrices.delete(a);
  for(const a of actors)if(!u32(a+0xb0))makeMatrix(a,identity);
  // Screen units from the manifest. Tap Trial uses the original wide projection,
  // x +/-416, y +/-228 (CellAnimManager::setupProj); Hole in One's 854x480 is not yet qualified.
  const [w,h]=g.manifest.wii.projection,origin=[canvas.width/w,0,0,canvas.height/h,canvas.width/2,canvas.height/2];
  const drawn=actors.filter(a=>u8(a+12)!==255&&u8(a+0xa7)&&!(u32(a+0xb0)&&u8(a+0xc2))).sort((a,b)=>(u32(b+0x98)|0)-(u32(a+0x98)|0));
  for(const a of drawn)drawActor(a,origin);
  layout?.draw(ctx,canvas);
  ctx.globalAlpha=1;
 }
 return {draw,layout};
}
