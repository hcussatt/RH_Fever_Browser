// Draws the original cell animations the way CCellAnim::makeMtx and CCellAnim::draw do
// (src/GameUtil/CellAnim.cpp): every frame the matrices are rebuilt from the root animations
// down, and an animation attached to an object of its base only moves while the base's
// current cell has that object; otherwise it keeps its last matrix. An attached animation
// drawn with its base (mBaseAnimDraw) is drawn right after that object, not by layer.
// A game's 2D layout (layout.mjs) and the chart's message panes (message.mjs) are drawn over the
// cell animations.
import {createLayout} from './layout.mjs';
import {createMessages} from './message.mjs';
import {assetImage,assetResponse} from './assets.mjs';
// A remix's scenes each build their own game's layout (Love Rap's captions, Bossa Nova's subtitles):
// the running scene's is drawn, with the layout events from while it ran (assets/layouts.json).
// A layout the game draws only into its dynamic texture (spec.screen, Shrimp Shuffle's shore) is
// drawn through the screen bank instead (see drawScreen below).
async function sceneLayouts(g){
 const list=await (await assetResponse(new URL('assets/layouts.json',g.base))).json(),layouts=new Map();
 for(const {scene,file,font,spec} of list){const events=[];layouts.set(scene,{spec,events,layout:await createLayout(g,{spec,file,fontFile:font,events})});}
 let scene=g.chart.firstScene||0;
 const sync=()=>{for(const e of g.layoutEvents.splice(0)){scene=e.scene;layouts.get(e.scene)?.events.push(e);}};
 return {
  draw(ctx,canvas){sync();const l=layouts.get(scene);if(l&&!l.spec.screen)l.layout.draw(ctx,canvas);},
  screen(){sync();const l=layouts.get(scene);return l?.spec.screen?l:null;},
 };
}
async function gameLayout(g){
 const spec=g.manifest.wii.layout,layout=await createLayout(g);if(!layout)return null;
 return {draw(ctx,canvas){if(!spec.screen)layout.draw(ctx,canvas);},screen:()=>spec.screen?{spec,layout}:null};
}
export async function createRenderer(g,canvas){
 // The game's textures, then the permanent bank's (bank 254) and Remix 8's photo frame's (253, see runtime.mjs).
 const images=await Promise.all([...g.assets.textures,...(g.gradingData.permanent?.textures||[]),...(g.gradingData.remixMask?.textures||[])].map(n=>assetImage(new URL('assets/'+n,g.base))));
 const ctx=canvas.getContext('2d',{alpha:false});
 const layout=g.manifest.wii.scenes?await sceneLayouts(g):await gameLayout(g),messages=await createMessages(g);
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
 const children=a=>{const out=[];for(let c=u32(a+0xb4),n=0;c&&n<4096;c=u32(c+0xb8),n++)out.push(c);return out;}; // bounded past the pool size (2048): a canvas can carry a whole scene (Launch Party in Remix 6)
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
 // CCellAnimManager's TEV stage: colour = fore + (back - fore) * texture (CCellAnim::setBackColor,
 // fore 0xa0-0xa2, back 0xa3-0xa5). The defaults, black and white, leave the texture as it is.
 const plain=a=>!(u8(a+0xa0)|u8(a+0xa1)|u8(a+0xa2))&&(u8(a+0xa3)&u8(a+0xa4)&u8(a+0xa5))===255;
 // A tinted cell is drawn once per colour and kept; when a colour changes every frame (Air
 // Rally's sky through the day) only the blend reruns, from the cell's pixels read once, into a
 // canvas reused from the ones dropped.
 const coloredCells=new Map(),cellPixels=new Map(),spare=[],COLORED_PIXELS=16<<20;let coloredPixels=0;
 // The cell-animation render effect (CellAnimRenderEff.cpp, sCurrentEffType): 1 grayscale (the
 // texture's red in every channel), 2 invert (fore and back swapped), 3 edges (inverted, and only
 // pixels below full alpha drawn). The scene's front cell animations draw with it (CExScene::_1C).
 let effect=0;
 function colored(texture,o,a){
  let fore=[u8(a+0xa0),u8(a+0xa1),u8(a+0xa2)],back=[u8(a+0xa3),u8(a+0xa4),u8(a+0xa5)];
  if(effect===2||effect===3)[fore,back]=[back,fore];
  const region=[texture,o.sx,o.sy,o.w,o.h].join(),id=region+'/'+[...fore,...back].join()+'/'+effect;
  const hit=coloredCells.get(id);if(hit){coloredCells.delete(id);coloredCells.set(id,hit);return hit;}
  let src=cellPixels.get(region);
  if(!src){
   const c=document.createElement('canvas');c.width=o.w;c.height=o.h;const x=c.getContext('2d',{willReadFrequently:true});
   x.drawImage(images[texture],o.sx,o.sy,o.w,o.h,0,0,o.w,o.h);src=x.getImageData(0,0,o.w,o.h).data;cellPixels.set(region,src);
  }
  // The least recently drawn tint makes way when too many are kept. The budget holds a whole
  // frame's tints (Packing Pests draws ~320 tinted cells, each in its own depth fog), so a scene
  // whose colours hold still never blends again.
  while(coloredCells.size&&(coloredCells.size>=4096||coloredPixels+o.w*o.h>COLORED_PIXELS)){const [old,c]=coloredCells.entries().next().value;coloredCells.delete(old);coloredPixels-=c.width*c.height;spare.push(c);}
  const i=spare.findIndex(c=>c.width===o.w&&c.height===o.h);
  const c=i>=0?spare.splice(i,1)[0]:Object.assign(document.createElement('canvas'),{width:o.w,height:o.h});
  if(spare.length>32)spare.shift();
  const x=c.getContext('2d'),d=x.createImageData(o.w,o.h),p=d.data;
  const lut=[0,1,2].map(ch=>Uint8ClampedArray.from({length:256},(_,v)=>fore[ch]+(back[ch]-fore[ch])*v/255));
  const [g,b]=effect===1?[0,0]:[1,2];
  for(let i=0;i<p.length;i+=4){p[i]=lut[0][src[i]];p[i+1]=lut[1][src[i+g]];p[i+2]=lut[2][src[i+b]];p[i+3]=effect===3&&src[i+3]===255?0:src[i+3];}
  x.putImageData(d,0,0);coloredCells.set(id,c);coloredPixels+=o.w*o.h;return c;
 }
 // The screen bank's texture (CDynTex, see adapters/wii/platform.c): the layout's colours drawn
 // over black, and its alpha pass as grey. Drawn with the cell's usual blend, the screen becomes
 // colour*alpha + screen*(1-alpha): multiply by 1-alpha, then add colour*alpha.
 const surface=()=>Object.assign(document.createElement('canvas'),{width:640,height:456});
 let screenTex=null;
 function renderScreen(l){
  screenTex||={color:surface(),alpha:surface(),inverse:surface(),product:surface()};
  const {color,alpha,inverse,product}=screenTex,fill=(c,style)=>{const x=c.getContext('2d');x.setTransform(1,0,0,1,0,0);x.globalAlpha=1;x.globalCompositeOperation='source-over';x.fillStyle=style;x.fillRect(0,0,640,456);return x;};
  l.layout.draw(fill(color,'#000'),color,{snap:true});
  l.layout.draw(fill(alpha,'#000'),alpha,{snap:true,additive:l.spec.screen.additive});
  let x=fill(inverse,'#fff');x.globalCompositeOperation='difference';x.drawImage(alpha,0,0);
  x=fill(product,'#000');x.drawImage(color,0,0);x.globalCompositeOperation='multiply';x.drawImage(alpha,0,0);
  // The columns the layout covers, read once (the shore's panes keep their width).
  if(!screenTex.span){
   const d=alpha.getContext('2d').getImageData(0,0,640,456).data;let x0=640,x1=0;
   for(let y=0;y<456;y++)for(let x=0;x<640;x++)if(d[(y*640+x)*4]){if(x<x0)x0=x;if(x>=x1)x1=x+1;}
   if(x1>x0)screenTex.span=[x0,x1];
  }
 }
 // The game tiles the texture side by side (Shrimp Shuffle's shore, one tile per 468 texels). The
 // Wii draws it texel for texel, but the canvas magnifies it, and filtering would blend each tile's
 // edge with the transparent texels beside it: the background then showed through as a thin line
 // between tiles. Each tile is clipped to its covered columns, rounded to whole pixels, so
 // neighbouring tiles meet edge to edge.
 function drawScreen(om,alpha){
  const span=screenTex.span,flat=!om[1]&&!om[2];
  ctx.save();
  if(span&&flat){const X=x=>Math.round(om[0]*(x-320)+om[4]);ctx.setTransform(1,0,0,1,0,0);ctx.beginPath();ctx.rect(X(span[0]),0,X(span[1])-X(span[0]),ctx.canvas.height);ctx.clip();}
  ctx.setTransform(...om);ctx.globalAlpha=alpha;
  ctx.globalCompositeOperation='multiply';ctx.drawImage(screenTex.inverse,-320,-228);
  ctx.globalCompositeOperation='lighter';ctx.drawImage(screenTex.product,-320,-228);
  ctx.restore();
 }
 function drawActor(a,origin){
  const k=key(a),m=matrices.get(a);if(!m)return;
  const bank=banks[u8(a+12)],opacity=u8(a+0xa6),attached=children(a).filter(c=>u8(c+0xc2)&&u8(c+0xa7)&&current.has(c));
  cell(a).forEach((o,i)=>{
   const alpha=Math.floor(k.alpha*o.alpha*opacity/255/255)/255;
   if(alpha&&o.w&&o.h){
    ctx.imageSmoothingEnabled=!!u8(a+0xa8);
    const om=mul(mul(origin,m),trs(o.x+o.w*o.scaleX/2,o.y+o.h*o.scaleY/2,o.angle,o.scaleX*(o.flipX?-1:1),o.scaleY*(o.flipY?-1:1)));
    if(bank.screen){if(!plain(a))throw new Error('Screen bank drawn with a tint');if(screenTex)drawScreen(om,alpha);}
    else{
     ctx.setTransform(...om);ctx.globalAlpha=alpha;
     if(plain(a)&&!effect)ctx.drawImage(images[bank.texture],o.sx,o.sy,o.w,o.h,-o.w/2,-o.h/2,o.w,o.h);
     else ctx.drawImage(colored(bank.texture,o,a),-o.w/2,-o.h/2,o.w,o.h);
    }
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
  effect=u32(0x803204d8);if(effect>3)effect=0; // fn_8009E204 draws any other type plainly
  current=new Set(actors);
  for(const a of matrices.keys())if(!current.has(a))matrices.delete(a);
  for(const a of actors)if(!u32(a+0xb0))makeMatrix(a,identity);
  // Screen units from the manifest. Tap Trial uses the original wide projection,
  // x +/-416, y +/-228 (CellAnimManager::setupProj); Hole in One's 854x480 is not yet qualified.
  const [w,h]=g.manifest.wii.projection,origin=[canvas.width/w,0,0,canvas.height/h,canvas.width/2,canvas.height/2];
  // CExScene::_1C hides the "you" marker while the screen shows an instruction example (lbl_80320228).
  const hiddenYou=u8(0x80320228)?u32(0x80320200):0;
  const drawn=actors.filter(a=>u8(a+12)!==255&&u8(a+0xa7)&&a!==hiddenYou&&!(u32(a+0xb0)&&u8(a+0xc2))).sort((a,b)=>(u32(b+0x98)|0)-(u32(a+0x98)|0));
  // The dynamic texture is redrawn each frame a screen bank shows (CDynTex::update).
  const screen=layout?.screen();
  if(screen&&actors.some(a=>banks[u8(a+12)]?.screen&&u8(a+0xa7)))renderScreen(screen);
  for(const a of drawn)drawActor(a,origin);
  layout?.draw(ctx,canvas);messages.draw(ctx,canvas);
  // CFaderFlash's black cover over everything (fn_80007DD8), as the chart fades it.
  const cover=core._fader_cover();
  if(cover){ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=cover/255;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);}
  ctx.globalAlpha=1;
 }
 return {draw,layout,messages};
}
