// Draws a game's 2D layout (NW4R lyt) the way the original does: panes in a tree, pictures and
// text boxes tinted by their material's two colour registers, and BRLAN keyframe animations
// driven like CLayoutAnimation (src/GameUtil/LayoutAnimation.cpp) and CLayout::_18.
// The game's code drives it through layout events (11) from the platform backend: play or stop
// an animation, set a text box's message or show it, or offset a pane (see adapters/<game>/game.h).
import {assetResponse,assetImage} from './assets.mjs';
import {windowPixels} from './layout-window.mjs';
export async function createLayout(g,{spec=g.manifest.wii.layout,file='layout.json',fontFile='layout-font.png',data:given,events=g.layoutEvents}={}){
 if(!spec)return null;
 const asset=n=>new URL('assets/'+n,g.base);
 const data=given??await (await assetResponse(asset(file))).json();
 const load=n=>assetImage(asset(n));
 const images=Object.fromEntries(await Promise.all(Object.entries(data.images).map(async([k,v])=>[k,await load(v)])));
 const fontImage=data.font?await load(fontFile):null;
 const byName=Object.fromEntries(data.panes.map((p,i)=>[p.name,i]));
 const children=data.panes.map(()=>[]);data.panes.forEach((p,i)=>{if(p.parent!=null)children[p.parent].push(i);});
 // Live pane values (animations write into them and they keep the last value, as in nw4r).
 // spec.hidden: panes the game's setup hides (Bossa Nova's CMyLayout::_10 hides its subtitle).
 const hidden=new Set(spec.hidden||[]);
 const fresh=p=>({...p,translate:[...p.translate],scale:[...p.scale],size:[...p.size],fontSize:p.fontSize&&[...p.fontSize],text:'',visible:p.visible&&!hidden.has(p.name)});
 const panes=data.panes.map(fresh);
 // The panes as the layout file sets them up, and its animations bound but stopped, for a layout
 // the game builds again (a new scene).
 function reset(){data.panes.forEach((p,i)=>{panes[i]=fresh(p);});for(const a of animations)Object.assign(a,{frame:0,playing:false,skip:false,enabled:false,reverse:false,loop:undefined});atEnd();}
 const materialImage=data.materials.map(m=>m.texture==null?null:data.textures[m.texture]);
 // Live material values that RLTS and RLMC animations write into. A material without its own TEV
 // stages keeps its two colour registers as color0 and color1 (the lyric layout's title card fades them).
 const live=data.materials.map(m=>({srts:m.srts?.map(s=>[...s]),tevColors:m.tevColors?.map(c=>[...c])??(m.stages?undefined:[[...m.color0],[...m.color1]]),kColors:m.kColors?.map(c=>[...c]),matColor:m.matColor&&[...m.matColor]}));
 const animations=spec.animations.map(([pane,name])=>{
  const anim=data.animations[name],root=byName[pane],inTree=new Set();
  const walk=i=>{inTree.add(data.panes[i].name);children[i].forEach(walk);};walk(root);
  // Bound recursively: the pane and its descendants (and their materials) that the animation names.
  const targets=Object.entries(anim.panes).filter(([n])=>inTree.has(n)||data.panes.some(p=>inTree.has(p.name)&&p.material!=null&&data.materials[p.material].name===n));
  return {anim,targets,frame:0,playing:false,skip:false,enabled:false,reverse:false};
 });
 const setFrame=(a,frame)=>{a.enabled=true;a.frame=frame;};
 const atEnd=()=>{for(const i of spec.startAtEnd||[])setFrame(animations[i],animations[i].anim.frames);};
 atEnd();
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
  // Reversed playback reads the animation from its end (CLayoutAnimation::fn_801DA66C).
  const f=Math.max(0,a.reverse?a.anim.frames-a.frame-1:a.frame);
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
  if(e.action===-1)return reset();
  const op=e.action>>8,i=e.action&255;
  if(op===1){const a=animations[i];a.reverse=false;setFrame(a,0);a.playing=true;a.skip=true;}
  // Play from the beginning, forward or reversed (value bit 1), or jump to the end (bit 0).
  else if(op===6){const a=animations[i];a.reverse=!!(e.value&2);setFrame(a,e.value&1?a.anim.frames:0);a.playing=true;a.skip=true;}
  else if(op===2)animations[i].playing=false;
  else if(op===8)animations[i].loop=!!e.value; // CLayoutAnimation::setLoop
  else if(op===3)panes[byName[spec.texts[i]]].text=message(e.value);
  else if(op===7)panes[byName[spec.texts[i]]].visible=!!e.value;
  else if(op===4||op===5){const n=spec.panes[i];panes[byName[n]].translate[op-4]=base[n][op-4]+f32(e.value);}
 }
 // One game frame of CLayout::_18: advance, animate the enabled animations in bind order, then
 // drop the stopped ones.
 function frame(){
  for(const a of animations){
   if(!a.playing)continue;
   if(a.skip){a.skip=false;continue;}
   let f=a.frame+1;
   while(f>=a.anim.frames){if(a.loop??a.anim.loop)f-=a.anim.frames;else{f=a.anim.frames-1;a.playing=false;}}
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
 // Bilinear sample of a map at (u, v) into out[at..at+3], 0-1.
 function sample(map,u,v,out,at){
  const t=map.t,x=u*t.w-.5,y=v*t.h-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
  const xa=wrap(x0,t.w,map.wrapS),xb=wrap(x0+1,t.w,map.wrapS),ya=wrap(y0,t.h,map.wrapT)*t.w,yb=wrap(y0+1,t.h,map.wrapT)*t.w;
  const w00=(1-fx)*(1-fy)/255,w10=fx*(1-fy)/255,w01=(1-fx)*fy/255,w11=fx*fy/255,k00=(ya+xa)*4,k10=(ya+xb)*4,k01=(yb+xa)*4,k11=(yb+xb)*4,d=t.d;
  for(let c=0;c<4;c++)out[at+c]=d[k00+c]*w00+d[k10+c]*w10+d[k01+c]*w01+d[k11+c]*w11;
 }
 // nw4r's texture SRT matrix: scale and rotate about the texture's centre, then translate.
 function srtMatrix(srt){const [tx,ty,r,sx,sy]=srt,a=r*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [sx*c,-sy*s,sx*s,sy*c,tx,ty];}
 // An indirect matrix from its SRT (nw4r::lyt::Material::SetupGX): rows (S, T) over the indirect
 // texel's (s, t, u), in texels of the stage's texture.
 function indMatrix(srt){const [tx,ty,r,sx,sy]=srt,a=r*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*sx,-s*sy,tx,s*sx,c*sy,ty];}
 const KONST=[1,7/8,3/4,5/8,1/2,3/8,1/4,1/8];
 // The values a stage reads, in one array: registers PREV, C0-C2 (0-15, rgba each), the texel
 // (16-19), the rasterised colour (20-23), the konstant colour (24-26) and alpha (27), then 1,
 // 1/2 and 0 (28-30). A colour input reads at offset+k (k = r, g, b) or at offset alone.
 const V_TEX=16,V_RAS=20,V_KONST=24,V_ONE=28,V_HALF=29,V_ZERO=30;
 const COLOR_IN=[[0,1],[3,0],[4,1],[7,0],[8,1],[11,0],[12,1],[15,0],[V_TEX,1],[V_TEX+3,0],[V_RAS,1],[V_RAS+3,0],[V_ONE,0],[V_HALF,0],[V_KONST,1],[V_ZERO,0]];
 const ALPHA_IN=[3,7,11,15,V_TEX+3,V_RAS+3,V_KONST+3,V_ZERO];
 // Each pane keeps its recent TEV results (an animated material has one per frame of its loop).
 const tevCache=new Map();
 // both (a layout drawn into a texture, Shrimp Shuffle's shore): the image and its alpha as grey in
 // colour and alpha alike (the alpha pass, see renderer.mjs). The pane's alpha is applied when
 // drawn, which matches nw4r's (in the vertex colours) when a stage's alpha scales with it.
 function tevImage(p,mi,both=false){
  const src=data.materials[mi],m=live[mi];
  if(src.blend&&!(src.blend[0]===1&&src.blend[1]===4&&src.blend[2]===5))throw new Error(`${src.name}: unsupported layout blend mode ${src.blend}`);
  if(src.alphaCompare&&src.alphaCompare[0]!==0x77)throw new Error(`${src.name}: unsupported layout alpha test ${src.alphaCompare}`);
  const key=JSON.stringify([m,p.vertexColors,both]);
  let cache=tevCache.get(p.name);if(!cache)tevCache.set(p.name,cache=new Map());
  if(cache.has(key))return cache.get(key);
  const maps=src.maps.map(x=>({...x,t:texels(data.textures[x.texture])})),W=Math.max(...maps.map(x=>x.t.w)),H=Math.max(...maps.map(x=>x.t.h));
  const gens=src.texCoordGens.map(([type,source,mtx])=>{
   if(type!==1||source!==4)throw new Error(`${src.name}: unsupported texture coordinate generator ${type}/${source}`);
   return mtx===60?[1,0,0,1,0,0]:srtMatrix(m.srts[(mtx-30)/3]);
  });
  const indMtx=(src.indSrts||[]).map(indMatrix);
  const [t0,t1,t2]=p.texcoords||[[0,0],[1,0],[0,1]],vc=p.vertexColors||[[255,255,255,255],[255,255,255,255],[255,255,255,255],[255,255,255,255]];
  const chan=src.chanCtrl?src.chanCtrl.map(x=>x===0):[false,false];
  const V=new Float64Array(32),start=new Float64Array(16),ind=new Float64Array(4),OUT=new Float64Array(3);
  for(let i=0;i<3;i++)for(let k=0;k<4;k++)start[4+i*4+k]=m.tevColors[i][k]/255;
  // Each stage, set up once: its konstants, input offsets, operation and indirect lookup.
  const stages=src.stages.map(st=>{
   const kc=st.color.konst,ka=st.alpha.konst;
   const konst=kc<8?[KONST[kc],KONST[kc],KONST[kc]]:kc>=12&&kc<16?m.kColors[kc-12].slice(0,3).map(x=>x/255):kc>=16?Array(3).fill(m.kColors[(kc-16)&3][(kc-16)>>2]/255):null;
   const konstA=ka<8?KONST[ka]:ka>=16?m.kColors[(ka-16)&3][(ka-16)>>2]/255:null;
   for(const cfg of [st.color,st.alpha])if(cfg.op>1)throw new Error(`${src.name}: unsupported TEV stage`);
   if((st.color.in.includes(14)&&!konst)||(st.alpha.in.includes(6)&&konstA==null))throw new Error(`${src.name}: unsupported TEV stage`);
   const c=st.color.in.map(i=>COLOR_IN[i]),a=st.alpha.in.map(i=>ALPHA_IN[i]);
   return {map:st.map===255?null:maps[st.map],gen:gens[st.texCoordGen],ras:st.channel!==255,konst:konst||[0,0,0],konstA:konstA??0,
    co:c.map(x=>x[0]),cs:c.map(x=>x[1]),ao:a,cSign:st.color.op?-1:1,aSign:st.alpha.op?-1:1,cBias:[0,.5,-.5][st.color.bias],aBias:[0,.5,-.5][st.alpha.bias],
    cScale:[1,2,4,.5][st.color.scale],aScale:[1,2,4,.5][st.alpha.scale],cClamp:st.color.clamp,aClamp:st.alpha.clamp,cOut:st.color.out*4,aOut:st.alpha.out*4+3,
    ind:st.ind?(I=>({divS:2**I.scaleS,divT:2**I.scaleT,gen:gens[I.texCoordGen],map:maps[I.map],mtx:indMtx[st.ind.matrix-1]}))(src.indStages[st.ind.stage]):null};
  });
  const c=document.createElement('canvas');c.width=W;c.height=H;const image=new ImageData(W,H),o=image.data;
  const ca=both?document.createElement('canvas'):null,alphaData=both?new ImageData(W,H):null,oa=alphaData?.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const s=(x+.5)/W,t=(y+.5)/H,u=t0[0]+s*(t1[0]-t0[0])+t*(t2[0]-t0[0]),v=t0[1]+s*(t1[1]-t0[1])+t*(t2[1]-t0[1]),du=u-.5,dv=v-.5;
   V.set(start);V[V_ONE]=1;V[V_HALF]=.5;V[V_ZERO]=0;
   // The rasterised channel: vertex colours (or the material colour), bilinear across the pane.
   for(let k=0;k<4;k++)V[V_RAS+k]=((vc[0][k]*(1-s)+vc[1][k]*s)*(1-t)+(vc[2][k]*(1-s)+vc[3][k]*s)*t)/255;
   if(chan[0])for(let k=0;k<3;k++)V[V_RAS+k]=m.matColor[k]/255;if(chan[1])V[V_RAS+3]=m.matColor[3]/255;
   for(let n=0;n<stages.length;n++){
    const S=stages[n];
    if(S.map){
     const g=S.gen;let su=g[0]*du+g[1]*dv+.5+g[4],sv=g[2]*du+g[3]*dv+.5+g[5];
     // GX indirect lookup (8-bit, biased by -128 in s, t and u): the indirect texture's alpha,
     // blue and green move this stage's coordinates by the matrix times them, in texels.
     if(S.ind){
      const I=S.ind,ig=I.gen;
      sample(I.map,(ig[0]*du+ig[1]*dv+.5+ig[4])/I.divS,(ig[2]*du+ig[3]*dv+.5+ig[5])/I.divT,ind,0);
      const cs=Math.round(ind[3]*255)-128,ct=Math.round(ind[2]*255)-128,cu=Math.round(ind[1]*255)-128,M=I.mtx;
      su+=(M[0]*cs+M[1]*ct+M[2]*cu)/S.map.t.w;sv+=(M[3]*cs+M[4]*ct+M[5]*cu)/S.map.t.h;
     }
     sample(S.map,su,sv,V,V_TEX);
    }else V[V_TEX]=V[V_TEX+1]=V[V_TEX+2]=V[V_TEX+3]=0;
    if(!S.ras)V[V_RAS]=V[V_RAS+1]=V[V_RAS+2]=V[V_RAS+3]=0;
    V[V_KONST]=S.konst[0];V[V_KONST+1]=S.konst[1];V[V_KONST+2]=S.konst[2];V[V_KONST+3]=S.konstA;
    const co=S.co,cs=S.cs;
    for(let k=0;k<3;k++){
     const a=V[co[0]+cs[0]*k],b=V[co[1]+cs[1]*k],cc=V[co[2]+cs[2]*k],d=V[co[3]+cs[3]*k];
     const q=(d+S.cSign*((1-cc)*a+cc*b)+S.cBias)*S.cScale;OUT[k]=S.cClamp?q<0?0:q>1?1:q:q;
    }
    const ao=S.ao,ac=V[ao[2]];
    let al=(V[ao[3]]+S.aSign*((1-ac)*V[ao[0]]+ac*V[ao[1]])+S.aBias)*S.aScale;if(S.aClamp)al=al<0?0:al>1?1:al;
    V[S.cOut]=OUT[0];V[S.cOut+1]=OUT[1];V[S.cOut+2]=OUT[2];V[S.aOut]=al;
   }
   const k=(y*W+x)*4;
   for(let ch=0;ch<4;ch++)o[k+ch]=Math.round(Math.min(Math.max(V[ch],0),1)*255);
   if(both)oa[k]=oa[k+1]=oa[k+2]=oa[k+3]=o[k+3];
  }
  c.getContext('2d').putImageData(image,0,0);
  let out=c;
  if(both){ca.width=W;ca.height=H;ca.getContext('2d').putImageData(alphaData,0,0);out={color:c,alpha:ca};}
  if(cache.size>=(both?256:64))cache.delete(cache.keys().next().value);cache.set(key,out);return out;
 }
 // The alpha pass of a picture without TEV stages: its texel alpha times the pane's, as grey.
 const alphaImages=new Map();
 function alphaImage(img,paneAlpha){
  const key=img.src??img;let byAlpha=alphaImages.get(key);if(!byAlpha)alphaImages.set(key,byAlpha=new Map());
  if(byAlpha.has(paneAlpha))return byAlpha.get(paneAlpha);
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0);
  const d=x.getImageData(0,0,c.width,c.height),q=d.data;
  for(let i=0;i<q.length;i+=4)q[i]=q[i+1]=q[i+2]=q[i+3]=Math.round(q[i+3]*paneAlpha/255);
  x.putImageData(d,0,0);byAlpha.set(paneAlpha,c);return c;
 }
 // GX fills the pixels whose centres a picture covers, with no partial edges: with pass.snap an
 // axis-aligned picture's edges round to whole pixels (its tiles in a texture then meet cleanly).
 function snapped(M,w,h){
  if(M[1]||M[2])return M;
  const x0=Math.round(M[4]),y0=Math.round(M[5]),x1=Math.round(M[4]+M[0]*w),y1=Math.round(M[5]+M[3]*h);
  return [(x1-x0)/w,0,0,(y1-y0)/h,x0,y0];
 }
 function drawPicture(ctx,p,m,alpha,pass){
  const alphaPass=!!pass?.additive;
  if(data.materials[p.material].stages){
   const r=rect(p),img=pass?tevImage(p,p.material,true)[alphaPass?'alpha':'color']:tevImage(p,p.material);
   const M=mul(m,[r.w/img.width,0,0,-r.h/img.height,r.left,r.top]);
   ctx.setTransform(...(pass?.snap?snapped(M,img.width,img.height):M));
   // The alpha pass adds (alpha*pane alpha) squared: the grey image's a*a times the pane's squared.
   if(alphaPass&&ctx.globalCompositeOperation!=='lighter'&&alpha<1)throw new Error(`${p.name}: blended alpha pass of a translucent pane`);
   ctx.globalAlpha=alphaPass?alpha*alpha:alpha;ctx.drawImage(img,0,0);return;
  }
  const name=materialImage[p.material];if(!name)return;
  const [color0,color1]=live[p.material].tevColors;let img=tint(images[name],{color0,color1},p.vertexColors?.[0]);const r=rect(p),W=img.width,H=img.height;
  if(alphaPass){img=alphaImage(img,Math.round(alpha*255));alpha=1;}
  // Map texture coordinates of the top-left, top-right and bottom-left corners onto the pane.
  const [t0,t1,t2]=p.texcoords||[[0,0],[1,0],[0,1]];
  const ux=(t1[0]-t0[0])*W,uy=(t1[1]-t0[1])*H,vx=(t2[0]-t0[0])*W,vy=(t2[1]-t0[1])*H,det=ux*vy-uy*vx;if(!det)return;
  // Affine A with A*(texel - t0) = corner - topLeft.
  const ax=[r.w,0],ay=[0,-r.h];
  const inv=[vy/det,-uy/det,-vx/det,ux/det];
  const A=[ax[0]*inv[0]+ay[0]*inv[1],ax[1]*inv[0]+ay[1]*inv[1],ax[0]*inv[2]+ay[0]*inv[3],ax[1]*inv[2]+ay[1]*inv[3]];
  const ox=r.left-(A[0]*t0[0]*W+A[2]*t0[1]*H),oy=r.top-(A[1]*t0[0]*W+A[3]*t0[1]*H);
  ctx.save();
  if(pass?.snap){const M=snapped(mul(m,[r.w,0,0,r.h,r.left,r.top-r.h]),1,1);ctx.setTransform(1,0,0,1,0,0);ctx.beginPath();ctx.rect(M[4],M[5],M[0],M[3]);}
  else{ctx.setTransform(...m);ctx.beginPath();ctx.rect(r.left,r.top-r.h,r.w,r.h);}
  ctx.clip();
  ctx.setTransform(...mul(m,[A[0],A[1],A[2],A[3],ox,oy]));ctx.globalAlpha=alpha;
  if(p.texcoords?.some(t=>t.some(x=>x<0||x>1))){ctx.fillStyle=ctx.createPattern(img,'repeat');ctx.fillRect(Math.min(...p.texcoords.map(t=>t[0]))*W,Math.min(...p.texcoords.map(t=>t[1]))*H,Math.abs(ux)+Math.abs(vx),Math.abs(uy)+Math.abs(vy));}
  else ctx.drawImage(img,0,0);
  ctx.restore();
 }
 const windows=new WeakMap();
 function drawWindow(ctx,p,m,alpha){
  if(p.frames.length!==1)throw new Error('Unsupported original window frame count');
  const material=data.materials[p.frames[0].material],img=tint(images[data.textures[material.texture]],material),r=rect(p);
  if(r.w<=0||r.h<=0)return;
  // Keep the content material separate: a speech balloon is white inside,
  // whereas Hole in One's frame has a transparent centre.
  const c=data.materials[p.material].color1,v=p.vertexColors?.[0]||[255,255,255,255];
  const fill=c.map((channel,i)=>Math.round(channel*v[i]/255)),width=Math.ceil(r.w),height=Math.ceil(r.h),key=[width,height,...fill].join(',');
  if(!windows.has(img))windows.set(img,new Map());
  const cache=windows.get(img);let surface=cache.get(key);
  if(!surface){
   surface=document.createElement('canvas');surface.width=width;surface.height=height;
   const corner=img.getContext('2d').getImageData(0,0,img.width,img.height);
   surface.getContext('2d').putImageData(new ImageData(windowPixels(corner,width,height,fill),width,height),0,0);
   // Animated window sizes must not retain an unbounded set of surfaces.
   if(cache.size>=32)cache.clear();cache.set(key,surface);
  }
  ctx.setTransform(...m);ctx.globalAlpha=alpha;ctx.drawImage(surface,r.left,-r.top,r.w,r.h);
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
    const cx=(g.cell%font.columns)*(font.atlasStrideX||font.cellWidth)+(font.atlasPadding||0),cy=Math.floor(g.cell/font.columns)*(font.atlasStrideY||font.cellHeight)+(font.atlasPadding||0);
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
 // pass.additive: draw the alpha pass (see tevImage), where the panes it lists add their alpha
 // squared (blend SRCALPHA, ONE) and the others blend it as usual. pass.snap: see snapped.
 function drawPane(ctx,i,parent,parentAlpha,influenced,pass){
  const p=panes[i];if(!p.visible)return;
  const a=p.rotate*Math.PI/180,c=Math.cos(a),s=Math.sin(a),sx=p.scale[0]*(p.locationAdjust?adjust:1),sy=p.scale[1];
  // Layout space has y up: flip the rotation and translation onto the canvas.
  const m=mul(parent,[c*sx,-s*sx,s*sy,c*sy,p.translate[0],-p.translate[1]]);
  const alpha=influenced?p.alpha*parentAlpha/255:p.alpha;
  if(alpha>0){
   if(pass&&(p.kind==='window'||p.kind==='text'))throw new Error(`Layout texture pass: unsupported ${p.kind} pane ${p.name}`);
   if(pass?.additive)ctx.globalCompositeOperation=pass.additive.includes(p.name)?'lighter':'source-over';
   if(p.kind==='picture')drawPicture(ctx,p,mul(m,[1,0,0,-1,0,0]),alpha/255,pass);
   else if(p.kind==='window')drawWindow(ctx,p,m,alpha/255);
   else if(p.kind==='text')drawText(ctx,p,m,alpha/255);
  }
  for(const k of children[i])drawPane(ctx,k,m,alpha,p.influencedAlpha,pass);
 }
 function draw(ctx,canvas,pass){
  update();
  const [w,h]=data.size,root=[canvas.width/w,0,0,canvas.height/h,canvas.width/2,canvas.height/2];
  drawPane(ctx,0,root,255,false,pass);
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
 }
 function textWidth(p,text=p.text){const font=data.font,sx=p.fontSize[0]/font.width;return Math.max(0,...text.split('\n').map(l=>[...l].reduce((n,c)=>n+(font.glyphs[c.codePointAt(0)]?.charWidth||0)*sx+p.charSpace,0)-(l.length?p.charSpace:0)));}
 function fitText(p,width,height){p.fontSize=[width,height];const w=textWidth(p),scale=w>p.size[0]?p.size[0]*.95/w:1;p.fontSize[0]*=scale;return scale;}
 return {draw,update,reset,panes,animations,byName,data,fitText};
}
