// Draws the game's top screen with WebGL 2 from the GPU commands the game recorded (picagl.c):
// FILL clears a render target, TEX uploads a decoded texture, DRAW draws triangles with the PICA's
// pixel state (texture combiners as a generated shader, alpha test, blending), PRESENT shows a target
// on the canvas the way the display transfer does (2:1 horizontal downscale, turned upright).
const VS=`#version 300 es
in vec3 aPos;in vec4 aCol;in vec2 aT0,aT1,aT2;out vec4 vCol;out vec2 vT0,vT1,vT2;
void main(){gl_Position=vec4(aPos.x,aPos.y,0.0,aPos.z);vCol=aCol;vT0=aT0;vT1=aT1;vT2=aT2;}`;
const PRESENT_VS=`#version 300 es
void main(){gl_Position=vec4(gl_VertexID==1?3.0:-1.0,gl_VertexID==2?3.0:-1.0,0.0,1.0);}`;
const PRESENT_FS=`#version 300 es
precision highp float;uniform sampler2D uT;uniform bool uFlip;out vec4 o;
void main(){float x=floor(gl_FragCoord.x),y=floor(gl_FragCoord.y);
  o=vec4(texture(uT,vec2((2.0*y+1.0)/480.0,((uFlip?x:399.0-x)+0.5)/400.0)).rgb,1.0);}`; // memory row 399-r is target row r
const ENV=[0xc0,0xc8,0xd0,0xd8,0xf0,0xf8];
function f24(v){v&=0xffffff;if(!(v&0x7fffff))return 0;const s=v>>23,e=v>>16&0x7f,m=v&0xffff;
  const b=new DataView(new ArrayBuffer(4));b.setUint32(0,((s<<31)|((e===0x7f?0xff:e+64)<<23)|(m<<7))>>>0);return b.getFloat32(0);}
const rgba=c=>[(c&255)/255,(c>>>8&255)/255,(c>>>16&255)/255,(c>>>24)/255];

// The fragment shader for one texture-combiner setup, the same steps as raster_tri in pica.c.
function fragmentShader(reg,texcfg,alphaTest,params){
  const src=s=>['prim','prim','vec4(0.0)','t0','t1','t2','vec4(0.0,0.0,0.0,1.0)'][s]||(s===13?'buf':s===14?`uC[${'$'}]`:s===15?'prev':'vec4(0.0)');
  const opRgb=(o,c)=>({0:`${c}.rgb`,1:`1.0-${c}.rgb`,2:`vec3(${c}.a)`,3:`vec3(1.0-${c}.a)`,4:`vec3(${c}.r)`,5:`vec3(1.0-${c}.r)`,8:`vec3(${c}.g)`,9:`vec3(1.0-${c}.g)`,12:`vec3(${c}.b)`,13:`vec3(1.0-${c}.b)`})[o]||`${c}.rgb`;
  const opA=(o,c)=>[`${c}.a`,`1.0-${c}.a`,`${c}.r`,`1.0-${c}.r`,`${c}.g`,`1.0-${c}.g`,`${c}.b`,`1.0-${c}.b`][o];
  const fn=(f,a,b,c,one)=>({0:a,1:`${a}*${b}`,2:`${a}+${b}`,3:`${a}+${b}-${one}*0.5`,4:`${a}*${c}+${b}*(${one}-${c})`,5:`${a}-${b}`,8:`${a}*${b}+${c}`,9:`min(${a}+${b},${one})*${c}`})[f]||a;
  const e0=reg(0xe0);let body='';
  ENV.forEach((r,st)=>{
    const srcs=reg(r),ops=reg(r+1),fns=reg(r+2),scale=reg(r+4);
    if((srcs&0xf000f)===0xf000f&&!(ops&0x7000f)&&!fns&&!(scale&0x30003)&&!(st<4&&(e0>>(8+st)&0x11))){body+='buf=nextbuf;\n';return;}
    const s=k=>src(srcs>>(4*k)&15).replace('$',st),sa=k=>src(srcs>>(16+4*k)&15).replace('$',st);
    const fr=fns&15,fa=fns>>16&15;
    body+=`{vec3 a0=${opRgb(ops&15,s(0))},a1=${opRgb(ops>>4&15,s(1))},a2=${opRgb(ops>>8&15,s(2))};`;
    body+=`float b0=${opA(ops>>12&7,sa(0))},b1=${opA(ops>>15&7,sa(1))},b2=${opA(ops>>18&7,sa(2))};vec4 o;`;
    if(fr===6||fr===7)body+='o.rgb=vec3(4.0*dot(a0-0.5,a1-0.5));';
    else body+=`o.rgb=${fn(fr,'a0','a1','a2','vec3(1.0)')};`;
    body+=fr===7?'o.a=o.r;':`o.a=${fn(fa,'b0','b1','b2','1.0')};`;
    body+=`o.rgb*=${1<<(scale&3)}.0;o.a*=${1<<(scale>>16&3)}.0;o=clamp(o,0.0,1.0);prev=o;buf=nextbuf;`;
    if(st<4){if(e0>>(8+st)&1)body+='nextbuf.rgb=o.rgb;';if(e0>>(12+st)&1)body+='nextbuf.a=o.a;';}
    body+='}\n';});
  // Clamp to border (wrap mode 1) on either axis: outside 0..1 the unit's border color.
  const tex=(u,t)=>{if(!(texcfg>>u&1))return 'vec4(0.0,0.0,0.0,1.0)';const bs=(params[u]>>12&7)===1,bt=(params[u]>>8&7)===1;
    const out=[bs&&`${t}.x<0.0||${t}.x>1.0`,bt&&`${t}.y<0.0||${t}.y>1.0`].filter(Boolean).join('||');
    return out?`((${out})?uBorder[${u}]:texture(uT${u},${t}))`:`texture(uT${u},${t})`;};
  let test='';
  if(alphaTest&1){const f=alphaTest>>4&7,c=['false','true','abs(prev.a-uRef)<0.5/255.0','abs(prev.a-uRef)>=0.5/255.0','prev.a<uRef-0.5/255.0','prev.a<uRef+0.5/255.0','prev.a>uRef+0.5/255.0','prev.a>uRef-0.5/255.0'][f];test=`if(!(${c}))discard;`;}
  return `#version 300 es
precision highp float;in vec4 vCol;in vec2 vT0,vT1,vT2;uniform sampler2D uT0,uT1,uT2;uniform vec4 uC[6],uBorder[3];uniform vec4 uBuf;uniform float uRef;out vec4 outColor;
void main(){vec4 prim=clamp(vCol,0.0,1.0),t0=${tex(0,'vT0')},t1=${tex(1,'vT1')},t2=${tex(2,texcfg>>13&1?'vT1':'vT2')};
vec4 prev=prim,buf=vec4(0.0),nextbuf=uBuf;
${body}${test}outColor=prev;}`;}

export function createGpu(canvas){
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
  if(!gl)return null;
  const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)+'\n'+src);return s;};
  const vs=compile(gl.VERTEX_SHADER,VS),presentVs=compile(gl.VERTEX_SHADER,PRESENT_VS);
  const link=(fs,v=vs)=>{const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));
    ['aPos','aCol','aT0','aT1','aT2'].forEach((n,i)=>gl.bindAttribLocation(p,i,n));gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
    const u=n=>gl.getUniformLocation(p,n);return {p,uT:[u('uT0'),u('uT1'),u('uT2')],uC:u('uC'),uBuf:u('uBuf'),uBorder:u('uBorder'),uRef:u('uRef'),uFlip:u('uFlip')};};
  const present=link(PRESENT_FS,presentVs),programs=new Map(),textures=new Map(),targets=new Map(),samplers=new Map();
  const vbo=gl.createBuffer(),vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
  [[3,0],[4,12],[2,28],[2,36],[2,44]].forEach(([n,o],i)=>{gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,n,gl.FLOAT,false,52,o);});
  const FACTOR=[gl.ZERO,gl.ONE,gl.SRC_COLOR,gl.ONE_MINUS_SRC_COLOR,gl.DST_COLOR,gl.ONE_MINUS_DST_COLOR,gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.DST_ALPHA,gl.ONE_MINUS_DST_ALPHA,gl.CONSTANT_COLOR,gl.ONE_MINUS_CONSTANT_COLOR,gl.CONSTANT_ALPHA,gl.ONE_MINUS_CONSTANT_ALPHA,gl.SRC_ALPHA_SATURATE];
  const EQ=[gl.FUNC_ADD,gl.FUNC_SUBTRACT,gl.FUNC_REVERSE_SUBTRACT,gl.MIN,gl.MAX];
  const WRAP=[gl.CLAMP_TO_EDGE,gl.CLAMP_TO_EDGE,gl.REPEAT,gl.MIRRORED_REPEAT]; // clamp to border: edge here, border color in the shader
  function sampler(param){let s=samplers.get(param);if(s)return s;s=gl.createSampler();
    gl.samplerParameteri(s,gl.TEXTURE_MAG_FILTER,param>>1&1?gl.LINEAR:gl.NEAREST);gl.samplerParameteri(s,gl.TEXTURE_MIN_FILTER,param>>2&1?gl.LINEAR:gl.NEAREST);
    gl.samplerParameteri(s,gl.TEXTURE_WRAP_S,WRAP[param>>12&3]);gl.samplerParameteri(s,gl.TEXTURE_WRAP_T,WRAP[param>>8&3]);samplers.set(param,s);return s;}
  function target(addr,w,h){const key=`${addr}:${w}:${h}`;let t=targets.get(key);if(t)return t;
    const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,w,h);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);t={addr,w,h,tex,fbo};targets.set(key,t);return t;}
  // heap: the wasm memory (Uint8Array); cmd, ncmd, vtx: the command and vertex buffers there.
  function run(heap,cmd,ncmd,vtx){
    const c=new Uint32Array(heap.buffer,cmd,ncmd);let nv=0;
    for(let i=0;i<ncmd;){const k=c[i];if(k===1)i+=5;else if(k===2)i+=5;else if(k===3){nv=Math.max(nv,c[i+4]+c[i+5]);i+=94;}else if(k===4)i+=3;else break;}
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
    if(nv)gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(heap.buffer,vtx,nv*13),gl.STREAM_DRAW);
    for(let i=0;i<ncmd;){const k=c[i];
      if(k===1){const start=c[i+1],end=c[i+2],v=c[i+3];i+=5;
        for(const t of targets.values())if(start<t.addr+t.w*t.h*4&&end>t.addr){gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);
          gl.clearColor((v>>>24)/255,(v>>>16&255)/255,(v>>>8&255)/255,(v&255)/255);gl.clear(gl.COLOR_BUFFER_BIT);}}
      else if(k===2){const id=c[i+1],w=c[i+2],h=c[i+3],ptr=c[i+4];i+=5;
        let t=textures.get(id);if(!t||t.w!==w||t.h!==h){if(t)gl.deleteTexture(t.tex);t={tex:gl.createTexture(),w,h};textures.set(id,t);
          gl.bindTexture(gl.TEXTURE_2D,t.tex);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,w,h);}
        gl.bindTexture(gl.TEXTURE_2D,t.tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,heap.subarray(ptr,ptr+w*h*4));}
      else if(k===3){draw(c.subarray(i,i+94));i+=94;}
      else if(k===4){const t=[...targets.values()].find(t=>t.addr===c[i+1]&&t.w===480&&t.h===400),flip=c[i+2]&1;i+=3;
        if(!t)continue;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,400,240);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND);gl.colorMask(true,true,true,true);
        gl.useProgram(present.p);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,t.tex);gl.bindSampler(0,null);gl.uniform1i(present.uT[0],0);gl.uniform1i(present.uFlip,flip);
        gl.drawArrays(gl.TRIANGLES,0,3);} // one triangle covering the canvas
      else break;}}
  function draw(d){
    const reg=r=>d[22+r-0xc0],texcfg=d[12],at=reg(0x104);
    const params=[d[14],d[17],d[20]],border=params.map(p=>(p>>12&7)===1|((p>>8&7)===1)<<1);
    const key=[...ENV.flatMap(r=>[reg(r),reg(r+1),reg(r+2),reg(r+4)]),reg(0xe0)&0xff00,texcfg&0x2007,at&0x71,...border].join(',');
    let prog=programs.get(key);if(!prog){prog=link(fragmentShader(reg,texcfg,at,params));programs.set(key,prog);}
    const t=target(d[1],d[2],d[3]);gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);
    const hw=f24(d[6]),hh=f24(d[7]),vx=d[8]&0x3ff,vy=d[8]>>>16&0x3ff;gl.viewport(vx,vy,Math.round(2*hw),Math.round(2*hh));
    if(d[9]&1){const x0=d[10]&0x3ff,y0=d[10]>>>16&0x3ff,x1=(d[11]&0x3ff)+1,y1=(d[11]>>>16&0x3ff)+1;gl.enable(gl.SCISSOR_TEST);gl.scissor(x0,y0,Math.max(0,x1-x0),Math.max(0,y1-y0));}else gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(prog.p);
    for(let u=0;u<3;u++){gl.activeTexture(gl.TEXTURE0+u);const tex=textures.get(d[13+3*u]);gl.bindTexture(gl.TEXTURE_2D,tex?tex.tex:null);gl.bindSampler(u,sampler(d[14+3*u]));gl.uniform1i(prog.uT[u],u);}
    gl.uniform4fv(prog.uC,ENV.flatMap(r=>rgba(reg(r+3))));gl.uniform4fv(prog.uBuf,rgba(reg(0xfd)));gl.uniform4fv(prog.uBorder,[d[15],d[18],d[21]].flatMap(rgba));gl.uniform1f(prog.uRef,(at>>>8&255)/255);
    const colorop=reg(0x100),blend=reg(0x101),mask=reg(0x107)>>>8&15;
    if(colorop>>8&1){gl.enable(gl.BLEND);gl.blendEquationSeparate(EQ[blend&7]??gl.FUNC_ADD,EQ[blend>>8&7]??gl.FUNC_ADD);
      gl.blendFuncSeparate(FACTOR[blend>>>16&15],FACTOR[blend>>>20&15],FACTOR[blend>>>24&15],FACTOR[blend>>>28&15]);gl.blendColor(...rgba(reg(0x103)));}
    else gl.disable(gl.BLEND);
    gl.colorMask(!!(mask&1),!!(mask&2),!!(mask&4),!!(mask&8));
    gl.drawArrays(gl.TRIANGLES,d[4],d[5]);}
  return {run};
}
