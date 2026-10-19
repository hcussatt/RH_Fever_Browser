// Draws a game's 2D layout (NW4R lyt) the way the original does: panes in a tree, pictures and
// text boxes tinted by their material's two colour registers, and BRLAN keyframe animations
// driven like CLayoutAnimation (src/GameUtil/LayoutAnimation.cpp) and CLayout::_18.
// The game's code drives it through layout events (11) from the platform backend: play or stop
// an animation, set a text box's message, or offset a pane (see adapters/<game>/game.h).
import {assetResponse,assetImage} from './assets.mjs';
export async function createLayout(g,{spec=g.manifest.wii.layout,file='layout.json',fontFile='layout-font.png',data:given,events=g.layoutEvents}={}){
 if(!spec)return null;
 const asset=n=>new URL('assets/'+n,g.base);
 const data=given??await (await assetResponse(asset(file))).json();
 const load=n=>assetImage(asset(n));
 const images=Object.fromEntries(await Promise.all(Object.entries(data.images).map(async([k,v])=>[k,await load(v)])));
 const fontImage=await load(fontFile);
 const byName=Object.fromEntries(data.panes.map((p,i)=>[p.name,i]));
 const children=data.panes.map(()=>[]);data.panes.forEach((p,i)=>{if(p.parent!=null)children[p.parent].push(i);});
 // Live pane values (animations write into them and they keep the last value, as in nw4r).
 const fresh=p=>({...p,translate:[...p.translate],scale:[...p.scale],size:[...p.size],fontSize:p.fontSize&&[...p.fontSize],text:''});
 const panes=data.panes.map(fresh);
 // The panes as the layout file sets them up, for a layout the game builds again (a new scene).
 function reset(){data.panes.forEach((p,i)=>{panes[i]=fresh(p);});}
 const materialImage=data.materials.map(m=>m.texture==null?null:data.textures[m.texture]);
 // Live material values that RLTS and RLMC animations write into.
 const live=data.materials.map(m=>({srts:m.srts?.map(s=>[...s]),tevColors:m.tevColors?.map(c=>[...c]),kColors:m.kColors?.map(c=>[...c]),matColor:m.matColor&&[...m.matColor]}));
 const animations=spec.animations.map(([pane,name])=>{
  const anim=data.animations[name],root=byName[pane],inTree=new Set();
  const walk=i=>{inTree.add(data.panes[i].name);children[i].forEach(walk);};walk(root);
  // Bound recursively: the pane and its descendants (and their materials) that the animation names.
  const targets=Object.entries(anim.panes).filter(([n])=>inTree.has(n)||data.panes.some(p=>inTree.has(p.name)&&p.material!=null&&data.materials[p.material].name===n));
  return {anim,targets,frame:0,playing:false,skip:false,enabled:false};
 });
 const setFrame=(a,frame)=>{a.enabled=true;a.frame=frame;};
 for(const i of spec.startAtEnd||[])setFrame(animations[i],animations[i].anim.frames);
 const base=Object.fromEntries((spec.panes||[]).map(n=>[n,[...data.panes[byName[n]].translate]]));
 let applied=0;

 function hermite(keys,f){
  const n=keys.length;if(f<=keys[0][0])return keys[0][1];if(f>=keys[n-1][0])return keys[n-1][1];
  let r=1;while(keys[r][0]<f)r++;
  if(keys[r][0]===f){while(r+1<n&&keys[r+1][0]===f)r++;return keys[r][1];}
  const [f0,v0,s0]=keys[r-1],[f1,v1,s1]=keys[r],t1=f-f0,t2=1/(f1-f0);
  const a=t1*t1*t2,b=a*t2,c=t1*b,d=c*t2;
  return v0*(2*d-3*b+1)+v1*(-2*d+3*b)+s0*(c-2*a+t1)+s1*(c-a);
 }
 function step(keys,f){if(f<=keys[0][0])return keys[0][1];let v=keys[0][1];for(const k of keys)if(k[0]<=f)v=k[1];return v;}
 function animate(a){
  const f=Math.max(0,a.frame);
  for(const [name,tags] of a.targets){
   const p=panes[byName[name]];
   for(const [target,keys] of Object.entries(tags.RLPA||{})){
    const v=hermite(keys,f),t=+target;
    if(t<2)p.translate[t]=v;else if(t===5)p.rotate=v;else if(t===6||t===7)p.scale[t-6]=v;else if(t===8||t===9)p.size[t-8]=v;
   }
   if(tags.RLVC?.[16])p.alpha=Math.min(Math.max(hermite(tags.RLVC[16],f)+.5,0),255)|0;
   if(tags.RLVI?.[0])p.visible=!!step(tags.RLVI[0],f);
   if(tags.RLTP?.[0]){const m=data.materials.findIndex(m=>m.name===name);if(m>=0)materialImage[m]=a.anim.timg[step(tags.RLTP[0],f)];}
   if(tags.RLTS||tags.RLMC){
    const m=live[data.materials.findIndex(m=>m.name===name)];
    // Texture SRT (index.target): translate S/T, rotate, scale S/T, in the resource's order.
    for(const [key,keys] of Object.entries(tags.RLTS||{})){const [i,t]=key.includes('.')?key.split('.').map(Number):[0,+key];m.srts[i][t]=hermite(keys,f);}
    // Material colour 0-3, colour registers 4-15, konstant colours 16-31.
    for(const [key,keys] of Object.entries(tags.RLMC||{})){
     const t=+key,v=Math.min(Math.max(Math.round(hermite(keys,f)),0),255);
     if(t<4)m.matColor[t]=v;else if(t<16)m.tevColors[(t-4)>>2][(t-4)&3]=v;else m.kColors[(t-16)>>2][(t-16)&3]=v;
    }
   }
  }
 }
 const f32=u=>new Float32Array(new Uint32Array([u]).buffer)[0];
 function message(id){return (data.messages[id]??'???').replace(/\{[0-9a-f]*\}/g,'');}
 function apply(e){
  const op=e.action>>8,i=e.action&255;
  if(op===1){const a=animations[i];setFrame(a,0);a.playing=true;a.skip=true;}
  else if(op===2)animations[i].playing=false;
  else if(op===3)panes[byName[spec.texts[i]]].text=message(e.value);
  else if(op===4||op===5){const n=spec.panes[i];panes[byName[n]].translate[op-4]=base[n][op-4]+f32(e.value);}
 }
 // One game frame of CLayout::_18: advance, animate the enabled animations in bind order, then
 // drop the stopped ones.
 function frame(){
  for(const a of animations){
   if(!a.playing)continue;
   if(a.skip){a.skip=false;continue;}
   let f=a.frame+1;
   while(f>=a.anim.frames){if(a.anim.loop)f-=a.anim.frames;else{f=a.anim.frames-1;a.playing=false;}}
   setFrame(a,f);
  }
  for(const a of animations)if(a.enabled)animate(a);
  for(const a of animations)if(!a.playing)a.enabled=false;
 }
 // Catch up with the game: the events of each step, then that step's layout frame.
 function update(){
  while(applied<g.steps){
   while(events.length&&events[0].frame<=applied)apply(events.shift());
   frame();applied++;
  }
 }

 const tinted=new Map();
 // The material's TEV setup: colour = lerp(color0, color1, texture intensity), alpha likewise
 // from the texture's alpha.
 function tint(image,m,color=[255,255,255,255]){
  const key=image.src+'|'+m.color0+'|'+m.color1+'|'+color;if(tinted.has(key))return tinted.get(key);
  const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
  const x=c.getContext('2d');x.drawImage(image,0,0);const d=x.getImageData(0,0,c.width,c.height),p=d.data;
  for(let k=0;k<p.length;k+=4){const a=p[k+3]/255;
   for(let ch=0;ch<3;ch++)p[k+ch]=(m.color0[ch]+(m.color1[ch]-m.color0[ch])*p[k+ch]/255)*color[ch]/255;
   p[k+3]=(m.color0[3]+(m.color1[3]-m.color0[3])*a)*color[3]/255;}
  x.putImageData(d,0,0);tinted.set(key,c);return c;
 }
 // Each glyph is cut out with a clear border: a scaled drawImage of part of the font sheet
 // filters in the neighbouring cells' edge pixels, which showed as faint marks above letters.
 const glyphs=new WeakMap();
 function glyphImage(img,cx,cy,w,h){
  if(!glyphs.has(img))glyphs.set(img,new Map());
  const cache=glyphs.get(img),key=cx+','+cy+','+w;if(cache.has(key))return cache.get(key);
  const c=document.createElement('canvas');c.width=w+2;c.height=h+2;c.getContext('2d').drawImage(img,cx,cy,w,h,1,1,w,h);
  cache.set(key,c);return c;
 }
 const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
 const rect=p=>{const [w,h]=p.size,hx=p.origin%3,vy=Math.floor(p.origin/3);return {left:-w*hx/2,top:h*vy/2,w,h};};
 // Materials with their own TEV stages (the Superb stamp's stars: a gradient cut to a spinning
 // star) are combined per texel like GX: each stage samples its map through its coordinate
 // generator's texture SRT, then a, b, c, d mix as d+((1-c)a+cb), biased, scaled and clamped.
 const texelCache=new Map();
 function texels(name){
  if(!texelCache.has(name)){const img=images[name],c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);texelCache.set(name,{w:c.width,h:c.height,d:x.getImageData(0,0,c.width,c.height).data});}
  return texelCache.get(name);
 }
 const wrap=(i,n,mode)=>mode===1?((i%n)+n)%n:mode===2?(((i%(2*n))+2*n)%(2*n)<n?((i%(2*n))+2*n)%(2*n):2*n-1-((i%(2*n))+2*n)%(2*n)):Math.min(Math.max(i,0),n-1);
 function sample(map,u,v){
  const t=map.t,x=u*t.w-.5,y=v*t.h-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0,out=[0,0,0,0];
  for(const [dx,dy,w] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){
   const k=(wrap(y0+dy,t.h,map.wrapT)*t.w+wrap(x0+dx,t.w,map.wrapS))*4;for(let c=0;c<4;c++)out[c]+=t.d[k+c]/255*w;
  }
  return out;
 }
 // nw4r's texture SRT matrix: scale and rotate about the texture's centre, then translate.
 function srtMatrix(srt){const [tx,ty,r,sx,sy]=srt,a=r*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [sx*c,-sy*s,sx*s,sy*c,tx,ty];}
 const KONST=[1,7/8,3/4,5/8,1/2,3/8,1/4,1/8];
 const tevCache=new Map();
 function tevImage(p,mi){
  const src=data.materials[mi],m=live[mi];
  if(src.blend&&!(src.blend[0]===1&&src.blend[1]===4&&src.blend[2]===5))throw new Error(`${src.name}: unsupported layout blend mode ${src.blend}`);
  if(src.alphaCompare&&src.alphaCompare[0]!==0x77)throw new Error(`${src.name}: unsupported layout alpha test ${src.alphaCompare}`);
  const key=p.name+JSON.stringify([m,p.vertexColors]);if(tevCache.has(key))return tevCache.get(key);
  const maps=src.maps.map(x=>({...x,t:texels(data.textures[x.texture])})),W=Math.max(...maps.map(x=>x.t.w)),H=Math.max(...maps.map(x=>x.t.h));
  const gens=src.texCoordGens.map(([type,source,mtx])=>{
   if(type!==1||source!==4)throw new Error(`${src.name}: unsupported texture coordinate generator ${type}/${source}`);
   return mtx===60?[1,0,0,1,0,0]:srtMatrix(m.srts[(mtx-30)/3]);
  });
  const [t0,t1,t2]=p.texcoords||[[0,0],[1,0],[0,1]],vc=p.vertexColors||[[255,255,255,255],[255,255,255,255],[255,255,255,255],[255,255,255,255]];
  const c=document.createElement('canvas');c.width=W;c.height=H;const image=new ImageData(W,H),o=image.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const s=(x+.5)/W,t=(y+.5)/H,u=t0[0]+s*(t1[0]-t0[0])+t*(t2[0]-t0[0]),v=t0[1]+s*(t1[1]-t0[1])+t*(t2[1]-t0[1]);
   const reg=[[0,0,0,0],...m.tevColors.map(c=>c.map(x=>x/255))];
   // The rasterised channel: vertex colours (or the material colour), bilinear across the pane.
   const ras=[0,1,2,3].map(k=>((vc[0][k]*(1-s)+vc[1][k]*s)*(1-t)+(vc[2][k]*(1-s)+vc[3][k]*s)*t)/255);
   const chan=src.chanCtrl?src.chanCtrl.map(x=>x===0):[false,false];
   if(chan[0])for(let k=0;k<3;k++)ras[k]=m.matColor[k]/255;if(chan[1])ras[3]=m.matColor[3]/255;
   for(const st of src.stages){
    let tex=[0,0,0,0];
    if(st.map!==255){const g=gens[st.texCoordGen],du=u-.5,dv=v-.5;tex=sample(maps[st.map],g[0]*du+g[1]*dv+.5+g[4],g[2]*du+g[3]*dv+.5+g[5]);}
    const r=st.channel===255?[0,0,0,0]:ras,kc=st.color.konst,ka=st.alpha.konst;
    const konst=kc<8?[KONST[kc],KONST[kc],KONST[kc]]:kc>=12&&kc<16?m.kColors[kc-12].slice(0,3).map(x=>x/255):kc>=16?Array(3).fill(m.kColors[(kc-16)&3][(kc-16)>>2]/255):null;
    const konstA=ka<8?KONST[ka]:ka>=16?m.kColors[(ka-16)&3][(ka-16)>>2]/255:null;
    const colorIn=i=>[reg[0].slice(0,3),Array(3).fill(reg[0][3]),reg[1].slice(0,3),Array(3).fill(reg[1][3]),reg[2].slice(0,3),Array(3).fill(reg[2][3]),reg[3].slice(0,3),Array(3).fill(reg[3][3]),tex.slice(0,3),Array(3).fill(tex[3]),r.slice(0,3),Array(3).fill(r[3]),[1,1,1],[.5,.5,.5],konst,[0,0,0]][i];
    const alphaIn=i=>[reg[0][3],reg[1][3],reg[2][3],reg[3][3],tex[3],r[3],konstA,0][i];
    const combine=(cfg,a,b,cc,d)=>{if(cfg.op>1||a==null||b==null||cc==null||d==null)throw new Error(`${src.name}: unsupported TEV stage`);
     let x=d+(cfg.op?-1:1)*((1-cc)*a+cc*b)+[0,.5,-.5][cfg.bias];x*=[1,2,4,.5][cfg.scale];return cfg.clamp?Math.min(Math.max(x,0),1):x;};
    const ci=st.color.in.map(colorIn),col=[0,1,2].map(k=>combine(st.color,ci[0]?.[k],ci[1]?.[k],ci[2]?.[k],ci[3]?.[k]));
    const ai=st.alpha.in.map(alphaIn),alp=combine(st.alpha,...ai);
    reg[st.color.out]=[...col,reg[st.color.out][3]];reg[st.alpha.out][3]=alp;
   }
   const k=(y*W+x)*4;for(let ch=0;ch<4;ch++)o[k+ch]=Math.round(Math.min(Math.max(reg[0][ch],0),1)*255);
  }
  c.getContext('2d').putImageData(image,0,0);
  if(tevCache.size>256)tevCache.clear();tevCache.set(key,c);return c;
 }
 function drawPicture(ctx,p,m,alpha){
  if(data.materials[p.material].stages){
   const img=tevImage(p,p.material),r=rect(p);
   ctx.setTransform(...mul(m,[r.w/img.width,0,0,-r.h/img.height,r.left,r.top]));ctx.globalAlpha=alpha;ctx.drawImage(img,0,0);return;
  }
  const name=materialImage[p.material];if(!name)return;
  const img=tint(images[name],data.materials[p.material],p.vertexColors?.[0]),r=rect(p),W=img.width,H=img.height;
  // Map texture coordinates of the top-left, top-right and bottom-left corners onto the pane.
  const [t0,t1,t2]=p.texcoords||[[0,0],[1,0],[0,1]];
  const ux=(t1[0]-t0[0])*W,uy=(t1[1]-t0[1])*H,vx=(t2[0]-t0[0])*W,vy=(t2[1]-t0[1])*H,det=ux*vy-uy*vx;if(!det)return;
  // Affine A with A*(texel - t0) = corner - topLeft.
  const ax=[r.w,0],ay=[0,-r.h];
  const inv=[vy/det,-uy/det,-vx/det,ux/det];
  const A=[ax[0]*inv[0]+ay[0]*inv[1],ax[1]*inv[0]+ay[1]*inv[1],ax[0]*inv[2]+ay[0]*inv[3],ax[1]*inv[2]+ay[1]*inv[3]];
  const ox=r.left-(A[0]*t0[0]*W+A[2]*t0[1]*H),oy=r.top-(A[1]*t0[0]*W+A[3]*t0[1]*H);
  ctx.save();ctx.setTransform(...m);ctx.beginPath();ctx.rect(r.left,r.top-r.h,r.w,r.h);ctx.clip();
  ctx.setTransform(...mul(m,[A[0],A[1],A[2],A[3],ox,oy]));ctx.globalAlpha=alpha;
  if(p.texcoords?.some(t=>t.some(x=>x<0||x>1))){ctx.fillStyle=ctx.createPattern(img,'repeat');ctx.fillRect(Math.min(...p.texcoords.map(t=>t[0]))*W,Math.min(...p.texcoords.map(t=>t[1]))*H,Math.abs(ux)+Math.abs(vx),Math.abs(uy)+Math.abs(vy));}
  else ctx.drawImage(img,0,0);
  ctx.restore();
 }
 function drawWindow(ctx,p,m,alpha){
  if(p.frames.length!==1)throw new Error('Unsupported original window frame count');
  const material=data.materials[p.frames[0].material],img=tint(images[data.textures[material.texture]],material),r=rect(p);
  const w=img.width,h=img.height;
  // The content is the content material's colour 1 (no texture) times the vertex colour: white for
  // a speech balloon, clear for Hole in One's screen frame.
  const c=data.materials[p.material].color1,v=p.vertexColors?.[0]||[255,255,255,255];
  ctx.setTransform(...m);ctx.globalAlpha=alpha*c[3]*v[3]/255/255;ctx.fillStyle=`rgb(${c[0]*v[0]/255},${c[1]*v[1]/255},${c[2]*v[2]/255})`;ctx.fillRect(r.left+w,-r.top,r.w-2*w,r.h);if(r.h>2*h)ctx.fillRect(r.left,-r.top+h,r.w,r.h-2*h);
  ctx.globalAlpha=alpha;
  // NW4R's one-frame window mirrors its single corner into all four corners.
  for(const [right,bottom] of [[0,0],[1,0],[0,1],[1,1]]){
   ctx.save();ctx.translate(r.left+(right?r.w:0),-r.top+(bottom?r.h:0));ctx.scale(right?-1:1,bottom?-1:1);ctx.drawImage(img,0,0);ctx.restore();
  }
  ctx.drawImage(img,w-1,0,1,h,r.left+w,-r.top,r.w-2*w,h);
  ctx.save();ctx.translate(0,-r.top*2+r.h);ctx.scale(1,-1);ctx.drawImage(img,w-1,0,1,h,r.left+w,-r.top,r.w-2*w,h);ctx.restore();
  // The left and right edges stretch the corner's last row, mirrored for the right.
  ctx.drawImage(img,0,h-1,w,1,r.left,-r.top+h,w,r.h-2*h);
  ctx.save();ctx.translate(r.left*2+r.w,0);ctx.scale(-1,1);ctx.drawImage(img,0,h-1,w,1,r.left,-r.top+h,w,r.h-2*h);ctx.restore();
 }
 function drawText(ctx,p,m,alpha){
  if(!p.text)return;
  const font=data.font,img=tint(fontImage,data.materials[p.material],p.colors?.[0]);
  const sx=p.fontSize[0]/font.width,sy=p.fontSize[1]/font.height,lineHeight=font.lineFeed*sy+p.lineSpace;
  const glyph=c=>font.glyphs[c.codePointAt(0)];
  const lines=p.text.split('\n').map(l=>{const gs=[...l].map(glyph).filter(Boolean);return {gs,width:gs.reduce((s,g)=>s+g.charWidth*sx+p.charSpace,0)-(gs.length?p.charSpace:0)};});
  const width=Math.max(...lines.map(l=>l.width)),height=lines.length*font.lineFeed*sy+(lines.length-1)*p.lineSpace;
  const r=rect(p),hx=p.textPosition%3,vy=Math.floor(p.textPosition/3),align=p.alignment?p.alignment-1:hx;
  const left=r.left+(r.w-width)*hx/2;let y=r.top-(r.h-height)*vy/2;
  ctx.setTransform(...m);ctx.globalAlpha=alpha;
  for(const l of lines){
   let x=left+(width-l.width)*align/2;
   for(const g of l.gs){
    const cx=(g.cell%font.columns)*font.cellWidth,cy=Math.floor(g.cell/font.columns)*font.cellHeight;
    // The glyph hangs from the line's top. This transform's y axis points down, the layout's up.
    if(g.glyphWidth)ctx.drawImage(glyphImage(img,cx,cy,g.glyphWidth,font.cellHeight),x+(g.left-1)*sx,-y-sy,(g.glyphWidth+2)*sx,(font.cellHeight+2)*sy);
    x+=g.charWidth*sx+p.charSpace;
   }
   y-=lineHeight;
  }
 }
 // Wide screen: panes marked for location adjustment are narrowed by 608/832, which undoes the
 // stretch of the 4:3 layout over the 16:9 screen (CLayoutManager, src/GameUtil/LayoutManager.cpp).
 const adjust=608/832;
 function drawPane(ctx,i,parent,parentAlpha,influenced){
  const p=panes[i];if(!p.visible)return;
  const a=p.rotate*Math.PI/180,c=Math.cos(a),s=Math.sin(a),sx=p.scale[0]*(p.locationAdjust?adjust:1),sy=p.scale[1];
  // Layout space has y up: flip the rotation and translation onto the canvas.
  const m=mul(parent,[c*sx,-s*sx,s*sy,c*sy,p.translate[0],-p.translate[1]]);
  const alpha=influenced?p.alpha*parentAlpha/255:p.alpha;
  if(alpha>0){
   if(p.kind==='picture')drawPicture(ctx,p,mul(m,[1,0,0,-1,0,0]),alpha/255);
   else if(p.kind==='window')drawWindow(ctx,p,m,alpha/255);
   else if(p.kind==='text')drawText(ctx,p,m,alpha/255);
  }
  for(const k of children[i])drawPane(ctx,k,m,alpha,p.influencedAlpha);
 }
 function draw(ctx,canvas){
  update();
  const [w,h]=data.size,root=[canvas.width/w,0,0,canvas.height/h,canvas.width/2,canvas.height/2];
  drawPane(ctx,0,root,255,false);
  ctx.globalAlpha=1;
 }
 function textWidth(p,text=p.text){const font=data.font,sx=p.fontSize[0]/font.width;return Math.max(0,...text.split('\n').map(l=>[...l].reduce((n,c)=>n+(font.glyphs[c.codePointAt(0)]?.charWidth||0)*sx+p.charSpace,0)-(l.length?p.charSpace:0)));}
 function fitText(p,width,height){p.fontSize=[width,height];const w=textWidth(p),scale=w>p.size[0]?p.size[0]*.95/w:1;p.fontSize[0]*=scale;return scale;}
 return {draw,update,reset,panes,animations,byName,data,fitText};
}
