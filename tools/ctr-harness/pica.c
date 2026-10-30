// The 3DS GPU (PICA200) for the top screen: the game's GPU command lists run here, in software.
// GX commands: DMA copies, memory fills, command lists, display transfers (tiled render target -> linear
// framebuffer). Command lists set registers; a draw runs the game's vertex shader in an interpreter and
// rasterizes the triangles with the texture combiners, alpha test, depth test and blending.
// Addresses in command lists and GX commands are physical: VRAM 0x18000000, FCRAM 0x20000000.
#include <math.h>
static uint32_t pica_virt(uint32_t pa){
  if(pa>=0x18000000&&pa<0x18600000)return pa-0x18000000+0x1f000000;
  if(pa>=0x20000000&&pa<0x28000000)return pa-0x20000000+0x14000000;
  if(pa>=0x1c000000&&pa<0x1c100000)return pa-0x0c000000; // shared memory blocks (the system font), converted like linear memory
  return pa;}
static uint8_t*pm(uint32_t pa,uint32_t n){return p(pica_virt(pa),n);}
static int pica_log=-1;
static uint32_t preg[0x300];
typedef struct{float x,y,z,w;}vec4;
static vec4 vs_c[96],vs_fixed[16];static uint8_t vs_bool[16];static uint8_t vs_int[4][4];
static uint32_t vs_code[512],vs_desc[128],vs_code_at,vs_desc_at,vs_c_at,vs_c_buf[4],vs_c_n,fixed_at,fixed_buf[3],fixed_n;
static float f24(uint32_t v){v&=0xffffff;if(!(v&0x7fffff))return v&0x800000?-0.0f:0.0f;
  uint32_t s=v>>23,e=(v>>16)&0x7f,m=v&0xffff,b;if(e==0x7f)b=(s<<31)|(0xffu<<23)|(m<<7);else b=(s<<31)|((e+64)<<23)|(m<<7);float f;memcpy(&f,&b,4);return f;}
static float f31(uint32_t v){uint32_t s=v>>30&1,e=(v>>23)&0x7f,m=v&0x7fffff,b=(s<<31)|((e?e+64:0)<<23)|m;float f;memcpy(&f,&b,4);return f;}
static vec4 unpack24(uint32_t w0,uint32_t w1,uint32_t w2){ // 96 bits: w z y x, 24 bits each, first word highest
  vec4 r;r.x=f24(w2);r.y=f24((w2>>24)|(w1<<8));r.z=f24((w1>>16)|(w0<<16));r.w=f24(w0>>8);return r;}

// ---- textures ----
static const int morton[64]={0,1,4,5,16,17,20,21,2,3,6,7,18,19,22,23,8,9,12,13,24,25,28,29,10,11,14,15,26,27,30,31,
  32,33,36,37,48,49,52,53,34,35,38,39,50,51,54,55,40,41,44,45,56,57,60,61,42,43,46,47,58,59,62,63};
static uint32_t tiled_index(uint32_t x,uint32_t y,uint32_t w){ // pixel index in 8x8 tiles, rows of tiles from the top
  return ((y>>3)*(w>>3)+(x>>3))*64+morton[(y&7)*8+(x&7)];}
static const int etc_mod[8][4]={{2,8,-2,-8},{5,17,-5,-17},{9,29,-9,-29},{13,42,-13,-42},{18,60,-18,-60},{24,80,-24,-80},{33,106,-33,-106},{47,183,-47,-183}};
static int clamp8(int v){return v<0?0:v>255?255:v;}
static uint32_t etc1_texel(uint64_t blk,int x,int y){ // x,y within the 4x4 block, returns RGB
  int flip=blk>>32&1,diff=blk>>33&1,t1=blk>>37&7,t2=blk>>34&7,sub=flip?y>=2:x>=2;int r,g,b;
  if(diff){int r1=blk>>59&31,g1=blk>>51&31,b1=blk>>43&31;int dr=(int)(blk>>56&7),dg=(int)(blk>>48&7),db=(int)(blk>>40&7);
    if(dr>3)dr-=8;if(dg>3)dg-=8;if(db>3)db-=8;if(sub){r1+=dr;g1+=dg;b1+=db;}r=(r1<<3)|(r1>>2);g=(g1<<3)|(g1>>2);b=(b1<<3)|(b1>>2);}
  else{int sh=sub?0:4;r=(blk>>(56+sh)&15)*17;g=(blk>>(48+sh)&15)*17;b=(blk>>(40+sh)&15)*17;}
  int t=sub?t2:t1,i=x*4+y,lo=blk>>i&1,hi=blk>>(16+i)&1,m=etc_mod[t][hi*2+lo];
  return clamp8(r+m)|clamp8(g+m)<<8|clamp8(b+m)<<16;}
// One texel as RGBA (r in the low byte).
static uint32_t tex_fetch(uint8_t*B,uint32_t fmt,uint32_t w,uint32_t h,uint32_t x,uint32_t y){
  y=h-1-y; // textures are stored from the bottom row up
  if(fmt==12||fmt==13){ // ETC1, ETC1A4: 8x8 tiles of four 4x4 blocks
    uint32_t bs=fmt==13?16:8,tile=(y>>3)*(w>>3)+(x>>3),sub=((y&4)?2:0)+((x&4)?1:0);uint8_t*q=B+(tile*4+sub)*bs;uint64_t blk;memcpy(&blk,q+(fmt==13?8:0),8);uint32_t c=etc1_texel(blk,x&3,y&3),al=255;
    if(fmt==13){uint64_t ab;memcpy(&ab,q,8);al=(ab>>(((x&3)*4+(y&3))*4)&15)*17;}
    return c|al<<24;}
  uint32_t i=tiled_index(x,y,w);
  switch(fmt){
  case 0:{uint8_t*q=(B+i*4);return q[3]|q[2]<<8|q[1]<<16|(uint32_t)q[0]<<24;} // RGBA8 stored ABGR
  case 1:{uint8_t*q=(B+i*3);return q[2]|q[1]<<8|q[0]<<16|0xff000000u;}
  case 2:{uint16_t v=*(uint16_t*)(B+i*2);uint32_t r=v>>11&31,g=v>>6&31,b=v>>1&31;return (r<<3|r>>2)|(g<<3|g>>2)<<8|(b<<3|b>>2)<<16|(v&1?0xff000000u:0);}
  case 3:{uint16_t v=*(uint16_t*)(B+i*2);uint32_t r=v>>11&31,g=v>>5&63,b=v&31;return (r<<3|r>>2)|(g<<2|g>>4)<<8|(b<<3|b>>2)<<16|0xff000000u;}
  case 4:{uint16_t v=*(uint16_t*)(B+i*2);return (v>>12&15)*17|((v>>8&15)*17)<<8|((v>>4&15)*17)<<16|((v&15)*17)<<24;}
  case 5:{uint8_t*q=(B+i*2);return q[1]*0x010101u|(uint32_t)q[0]<<24;} // LA8
  case 6:{uint8_t*q=(B+i*2);return q[0]|q[1]<<8|0xff000000u;} // HILO8
  case 7:{uint8_t v=*(B+i);return v*0x010101u|0xff000000u;}
  case 8:{uint8_t v=*(B+i);return (uint32_t)v<<24;}
  case 9:{uint8_t v=*(B+i);return (v>>4)*17*0x010101u|(uint32_t)((v&15)*17)<<24;} // LA4
  case 10:{uint8_t v=*(B+i/2);v=i&1?v>>4:v&15;return v*17*0x010101u|0xff000000u;}
  case 11:{uint8_t v=*(B+i/2);v=i&1?v>>4:v&15;return (uint32_t)(v*17)<<24;}
  }
  return 0xffff00ffu;}
typedef struct{float r,g,b,a;}col4;
static inline col4 unpack_col(uint32_t c){const float k=1/255.f;return (col4){(c&255)*k,(c>>8&255)*k,(c>>16&255)*k,(c>>24)*k};}
static int wrap_coord(int v,int n,int mode){
  switch(mode){case 0:return v<0?0:v>=n?n-1:v; // clamp to edge
    case 2:return ((v%n)+n)%n; // repeat
    case 3:{int p2=2*n,m=((v%p2)+p2)%p2;return m<n?m:p2-1-m;} // mirrored repeat
    default:return v<0||v>=n?-1:v;}} // clamp to border
typedef struct{uint8_t*base;uint32_t addr,w,h,fmt,param,border;}texunit;static texunit tu[3];
static void setup_textures(void){static const int base[3]={0x81,0x91,0x99};
  for(int u=0;u<3;u++){int b=base[u];texunit*t=&tu[u];uint32_t dim=preg[b+1];t->param=preg[b+2];t->addr=preg[b+4]<<3;t->fmt=preg[u==0?0x8e:b+5]&15;
    t->w=dim>>16&0x7ff;t->h=dim&0x7ff;t->border=preg[b];uint32_t bits[14]={32,24,16,16,16,16,16,8,8,8,4,4,4,8};
    t->base=t->w&&t->h?pm(t->addr,t->w*t->h*bits[t->fmt<14?t->fmt:0]/8):0;}}
static col4 sample(int unit,float s,float t){
  texunit*T=&tu[unit];uint32_t param=T->param,addr=T->addr,fmt=T->fmt,w=T->w,h=T->h;
  if(!w||!h||!T->base)return (col4){0,0,0,1};
  int ws=param>>12&7,wt=param>>8&7,linear=param>>1&1;
  float fx=s*w-0.5f,fy=t*h-0.5f;
  if(!linear){int x=wrap_coord((int)floorf(s*w),w,ws),y=wrap_coord((int)floorf(t*h),h,wt);
    if(x<0||y<0)return unpack_col(T->border);return unpack_col(tex_fetch(T->base,fmt,w,h,x,y));}
  int x0=(int)floorf(fx),y0=(int)floorf(fy);float ax=fx-x0,ay=fy-y0;col4 r={0,0,0,0};
  for(int k=0;k<4;k++){int x=wrap_coord(x0+(k&1),w,ws),y=wrap_coord(y0+(k>>1),h,wt);float wgt=(k&1?ax:1-ax)*(k>>1?ay:1-ay);
    col4 c=x<0||y<0?unpack_col(T->border):unpack_col(tex_fetch(T->base,fmt,w,h,x,y));r.r+=c.r*wgt;r.g+=c.g*wgt;r.b+=c.b*wgt;r.a+=c.a*wgt;}
  return r;}

// ---- vertex shader ----
typedef struct{vec4 v[16],o[16],r[16];int a0x,a0y,aL;int cmp[2];int done,brk;}vs_state;
static float*comp(vec4*v,int i){return &v->x+i;}
static vec4 vs_src(vs_state*s,uint32_t reg,uint32_t swz,int neg,int idx){
  vec4 in;if(reg<0x10)in=s->v[reg];else if(reg<0x20)in=s->r[reg-0x10];else{int u=reg-0x20;
    if(idx==1)u+=s->a0x;else if(idx==2)u+=s->a0y;else if(idx==3)u+=s->aL;in=u>=0&&u<96?vs_c[u]:(vec4){1,1,1,1};}
  vec4 o;for(int i=0;i<4;i++)*comp(&o,i)=*comp(&in,(swz>>(6-2*i))&3)*(neg?-1:1);return o;}
static void vs_dst(vs_state*s,uint32_t reg,uint32_t mask,vec4 v){
  vec4*d=reg<0x10?&s->o[reg]:&s->r[(reg-0x10)&15];for(int i=0;i<4;i++)if(mask>>(3-i)&1)*comp(d,i)=*comp(&v,i);}
static float mulz(float a,float b){return a==0||b==0?0:a*b;} // the PICA's 0 * inf = 0
static int vs_cmp(int op,float a,float b){switch(op){case 0:return a==b;case 1:return a!=b;case 2:return a<b;case 3:return a<=b;case 4:return a>b;case 5:return a>=b;}return 1;}
static int vs_cond(vs_state*s,uint32_t ins){int rx=ins>>25&1,ry=ins>>24&1,op=ins>>22&3,x=s->cmp[0]==rx,y=s->cmp[1]==ry;
  return op==0?x||y:op==1?x&&y:op==2?x:y;}
static void vs_run(vs_state*s,uint32_t pc,uint32_t end,int depth){
  for(int guard=0;pc<512&&guard<100000;guard++){
    if(s->done||s->brk||(end&&pc==end))return;
    uint32_t ins=vs_code[pc],op=ins>>26;
    if(op>=0x38||(op&0x38)==0x30){ // MAD / MADI
      int inv=(op&0x38)==0x30;uint32_t desc=vs_desc[ins&31],dst=ins>>24&31,s1=ins>>17&31,s2,s3,idx=ins>>22&3;
      if(inv){s2=ins>>10&31;s3=ins>>5&31;}else{s2=ins>>10&127;s3=ins>>5&31;}
      vec4 a=vs_src(s,s1,desc>>5&255,desc>>4&1,0),b=vs_src(s,s2,desc>>14&255,desc>>13&1,inv?0:idx),c=vs_src(s,s3,desc>>23&255,desc>>22&1,inv?idx:0),r;
      for(int i=0;i<4;i++)*comp(&r,i)=mulz(*comp(&a,i),*comp(&b,i))+*comp(&c,i);vs_dst(s,dst,desc&15,r);pc++;continue;}
    if(op<0x20||op==0x2e||op==0x2f){
      int inv=op>=0x18&&op<0x1c;uint32_t desc=vs_desc[ins&127],dst=ins>>21&31,idx=ins>>19&3,s1,s2;
      if(op==0x2e||op==0x2f){s1=ins>>12&127;s2=ins>>7&31;}else if(inv){s1=ins>>14&31;s2=ins>>7&127;}else{s1=ins>>12&127;s2=ins>>7&31;}
      vec4 a=vs_src(s,s1,desc>>5&255,desc>>4&1,inv?0:idx),b=vs_src(s,s2,desc>>14&255,desc>>13&1,inv?idx:0),r={0,0,0,0};
      uint32_t base=inv?op-0x18+0:op;if(inv)base=(uint32_t[]){3,4,9,10}[op-0x18];
      switch(base){
      case 0x00:r=(vec4){a.x+b.x,a.y+b.y,a.z+b.z,a.w+b.w};break;
      case 0x01:{float d=mulz(a.x,b.x)+mulz(a.y,b.y)+mulz(a.z,b.z);r=(vec4){d,d,d,d};break;}
      case 0x02:{float d=mulz(a.x,b.x)+mulz(a.y,b.y)+mulz(a.z,b.z)+mulz(a.w,b.w);r=(vec4){d,d,d,d};break;}
      case 0x03:{float d=mulz(a.x,b.x)+mulz(a.y,b.y)+mulz(a.z,b.z)+b.w;r=(vec4){d,d,d,d};break;}
      case 0x04:r=(vec4){1,mulz(a.y,b.y),a.z,b.w};break;
      case 0x05:{float d=exp2f(a.x);r=(vec4){d,d,d,d};break;}
      case 0x06:{float d=log2f(a.x);r=(vec4){d,d,d,d};break;}
      case 0x08:r=(vec4){mulz(a.x,b.x),mulz(a.y,b.y),mulz(a.z,b.z),mulz(a.w,b.w)};break;
      case 0x09:r=(vec4){a.x>=b.x,a.y>=b.y,a.z>=b.z,a.w>=b.w};break;
      case 0x0a:r=(vec4){a.x<b.x,a.y<b.y,a.z<b.z,a.w<b.w};break;
      case 0x0b:r=(vec4){floorf(a.x),floorf(a.y),floorf(a.z),floorf(a.w)};break;
      case 0x0c:r=(vec4){a.x>b.x?a.x:b.x,a.y>b.y?a.y:b.y,a.z>b.z?a.z:b.z,a.w>b.w?a.w:b.w};break;
      case 0x0d:r=(vec4){a.x<b.x?a.x:b.x,a.y<b.y?a.y:b.y,a.z<b.z?a.z:b.z,a.w<b.w?a.w:b.w};break;
      case 0x0e:{float d=1/a.x;r=(vec4){d,d,d,d};break;}
      case 0x0f:{float d=1/sqrtf(a.x);r=(vec4){d,d,d,d};break;}
      case 0x12:if(desc>>3&1)s->a0x=(int)a.x;if(desc>>2&1)s->a0y=(int)a.y;pc++;continue;
      case 0x13:r=a;break;
      case 0x2e:case 0x2f:{int cy=(ins>>24)&7,cx=(ins>>21)&7;s->cmp[0]=vs_cmp(cx,a.x,b.x);s->cmp[1]=vs_cmp(cy,a.y,b.y);pc++;continue;}
      default:pc++;continue;}
      vs_dst(s,dst,desc&15,r);pc++;continue;}
    uint32_t off=ins>>10&0xfff,num=ins&255;
    switch(op){
    case 0x21:case 0x2a:case 0x2b:pc++;break;
    case 0x22:s->done=1;return;
    case 0x20:s->brk=1;return; // BREAK (inside a loop)
    case 0x23:if(vs_cond(s,ins)){s->brk=1;return;}pc++;break;
    case 0x24:if(depth<8)vs_run(s,off,off+num,depth+1);pc++;break;
    case 0x25:if(vs_cond(s,ins)&&depth<8)vs_run(s,off,off+num,depth+1);pc++;break;
    case 0x26:if(vs_bool[ins>>22&15]&&depth<8)vs_run(s,off,off+num,depth+1);pc++;break;
    case 0x27:case 0x28:{int c=op==0x27?vs_bool[ins>>22&15]:vs_cond(s,ins);
      if(c)vs_run(s,pc+1,off,depth+1);else if(num)vs_run(s,off,off+num,depth+1);pc=off+num;break;}
    case 0x29:{uint8_t*I=vs_int[ins>>22&3];s->aL=I[1];for(int k=0;k<=I[0]&&!s->done&&!s->brk;k++){vs_run(s,pc+1,off+1,depth+1);s->aL+=(int8_t)I[2];}s->brk=0;pc=off+1;break;}
    case 0x2c:if(vs_cond(s,ins))pc=off;else pc++;break;
    case 0x2d:{int c=vs_bool[ins>>22&15];if(num&1)c=!c;if(c)pc=off;else pc++;break;}
    default:pc++;break;}}}

// ---- rasterizer ----
typedef struct{vec4 pos;col4 col;float u0,v0,u1,v1,u2,v2,w0;}vtx;
static uint32_t pica_draws,pica_tris;static uint64_t pica_px,pica_box;
static col4 c4(float r,float g,float b,float a){return (col4){r,g,b,a};}
static col4 cclamp(col4 c){c.r=c.r<0?0:c.r>1?1:c.r;c.g=c.g<0?0:c.g>1?1:c.g;c.b=c.b<0?0:c.b>1?1:c.b;c.a=c.a<0?0:c.a>1?1:c.a;return c;}
static float blend_factor(int f,col4 s,col4 d,col4 k,int ch,int alpha){
  float sv=alpha?s.a:(&s.r)[ch],dv=alpha?d.a:(&d.r)[ch],kv=alpha?k.a:(&k.r)[ch];
  switch(f){case 0:return 0;case 1:return 1;case 2:return sv;case 3:return 1-sv;case 4:return dv;case 5:return 1-dv;
    case 6:return s.a;case 7:return 1-s.a;case 8:return d.a;case 9:return 1-d.a;case 10:return kv;case 11:return 1-kv;
    case 12:return k.a;case 13:return 1-k.a;case 14:{float m=s.a<1-d.a?s.a:1-d.a;return alpha?1:m;}}
  return 1;}
static uint32_t cb_addr,cb_w,cb_h,cb_fmt,db_addr,db_fmt;static uint8_t*cb_host;
static col4 cb_read(uint32_t x,uint32_t y){uint32_t i=tiled_index(x,y,cb_w);
  if(cb_fmt==0){uint8_t*q=cb_host+i*4;return c4(q[3]/255.f,q[2]/255.f,q[1]/255.f,q[0]/255.f);}
  return unpack_col(tex_fetch(cb_host,cb_fmt==1?1:cb_fmt==2?2:cb_fmt==3?3:4,cb_w,cb_h,x,cb_h-1-y));}
static void cb_write(uint32_t x,uint32_t y,col4 c,uint32_t mask){uint32_t i=tiled_index(x,y,cb_w);
  int r=c.r*255+.5f,g=c.g*255+.5f,b=c.b*255+.5f,a=c.a*255+.5f;
  if(cb_fmt==0){uint8_t*q=cb_host+i*4;if(mask&1)q[3]=r;if(mask&2)q[2]=g;if(mask&4)q[1]=b;if(mask&8)q[0]=a;}
  else if(cb_fmt==1){uint8_t*q=cb_host+i*3;if(mask&1)q[2]=r;if(mask&2)q[1]=g;if(mask&4)q[0]=b;}
  else if(cb_fmt==2){uint16_t*q=(uint16_t*)(cb_host+i*2);*q=(r>>3)<<11|(g>>3)<<6|(b>>3)<<1|(a>=128);}
  else if(cb_fmt==3){uint16_t*q=(uint16_t*)(cb_host+i*2);*q=(r>>3)<<11|(g>>2)<<5|(b>>3);}
  else{uint16_t*q=(uint16_t*)(cb_host+i*2);*q=(r>>4)<<12|(g>>4)<<8|(b>>4)<<4|(a>>4);}}
static float*depth_ptr(uint32_t x,uint32_t y,float*buf){(void)buf;return 0;}
static col4 combine_src(int src,col4 prim,col4 sec,col4*tex,col4 cst,col4 prev,col4 buf){
  switch(src){case 0:return prim;case 1:return prim;case 2:return sec;case 3:return tex[0];case 4:return tex[1];case 5:return tex[2];case 6:return tex[3];
    case 13:return buf;case 14:return cst;case 15:return prev;}
  return c4(0,0,0,0);}
static col4 operand_rgb(int op,col4 c){
  switch(op){case 0:return c;case 1:return c4(1-c.r,1-c.g,1-c.b,c.a);case 2:return c4(c.a,c.a,c.a,c.a);case 3:return c4(1-c.a,1-c.a,1-c.a,1-c.a);
    case 4:return c4(c.r,c.r,c.r,c.r);case 5:return c4(1-c.r,1-c.r,1-c.r,1-c.r);case 8:return c4(c.g,c.g,c.g,c.g);case 9:return c4(1-c.g,1-c.g,1-c.g,1-c.g);
    case 12:return c4(c.b,c.b,c.b,c.b);case 13:return c4(1-c.b,1-c.b,1-c.b,1-c.b);}
  return c;}
static float operand_a(int op,col4 c){switch(op){case 0:return c.a;case 1:return 1-c.a;case 2:return c.r;case 3:return 1-c.r;case 4:return c.g;case 5:return 1-c.g;case 6:return c.b;case 7:return 1-c.b;}return c.a;}
static float combine1(int fn,float a,float b,float c){
  switch(fn){case 0:return a;case 1:return a*b;case 2:return a+b;case 3:return a+b-0.5f;case 4:return a*c+b*(1-c);case 5:return a-b;
    case 8:return a*b+c;case 9:{float s=a+b;return (s>1?1:s)*c;}}
  return a;}
static void raster_tri(vtx*a,vtx*b,vtx*c){
  pica_tris++;
  // viewport transform
  float hw=f24(preg[0x41]),hh=f24(preg[0x43]);int vx=preg[0x68]&0x3ff,vy=preg[0x68]>>16&0x3ff;
  vtx*v[3]={a,b,c};float sx[3],sy[3],sz[3],iw[3];
  for(int i=0;i<3;i++){float w=v[i]->pos.w;if(w<=0)return;iw[i]=1/w;sx[i]=(v[i]->pos.x*iw[i]+1)*hw+vx;sy[i]=(v[i]->pos.y*iw[i]+1)*hh+vy;sz[i]=v[i]->pos.z*iw[i];}
  float area=(sx[1]-sx[0])*(sy[2]-sy[0])-(sx[2]-sx[0])*(sy[1]-sy[0]);if(area==0)return;
  int cull=preg[0x40]&3;if(cull==1&&area<0)return;if(cull==2&&area>0)return;
  int x0=floorf(fminf(sx[0],fminf(sx[1],sx[2]))),x1=ceilf(fmaxf(sx[0],fmaxf(sx[1],sx[2]))),y0=floorf(fminf(sy[0],fminf(sy[1],sy[2]))),y1=ceilf(fmaxf(sy[0],fmaxf(sy[1],sy[2])));
  if(x0<0)x0=0;if(y0<0)y0=0;if(x1>(int)cb_w)x1=cb_w;if(y1>(int)cb_h)y1=cb_h;
  if(preg[0x65]&1){int sx0=preg[0x66]&0x3ff,sy0=preg[0x66]>>16&0x3ff,sx1=(preg[0x67]&0x3ff)+1,sy1=(preg[0x67]>>16&0x3ff)+1;
    if(x0<sx0)x0=sx0;if(y0<sy0)y0=sy0;if(x1>sx1)x1=sx1;if(y1>sy1)y1=sy1;}
  uint32_t texcfg=preg[0x80];int tc2_from1=texcfg>>13&1;
  uint32_t blendcfg=preg[0x101],colorop=preg[0x100],at=preg[0x104],dcm=preg[0x107];
  col4 blendk=unpack_col(preg[0x103]);int wmask=(dcm>>8)&15;
  static const int envbase[6]={0xc0,0xc8,0xd0,0xd8,0xf0,0xf8};
  if(x1>x0&&y1>y0)pica_box+=(uint64_t)(x1-x0)*(y1-y0);
  for(int y=y0;y<y1;y++)for(int x=x0;x<x1;x++){
    float px=x+0.5f,py=y+0.5f;
    float w0=((sx[1]-px)*(sy[2]-py)-(sx[2]-px)*(sy[1]-py))/area,w1=((sx[2]-px)*(sy[0]-py)-(sx[0]-px)*(sy[2]-py))/area,w2=1-w0-w1;
    if(w0<0||w1<0||w2<0){if(w0<-1e-6f||w1<-1e-6f||w2<-1e-6f)continue;}
    pica_px++;float pw=w0*iw[0]+w1*iw[1]+w2*iw[2],k0=w0*iw[0]/pw,k1=w1*iw[1]/pw,k2=w2*iw[2]/pw;
#define LERP(f) (k0*v[0]->f+k1*v[1]->f+k2*v[2]->f)
    col4 prim=cclamp(c4(LERP(col.r),LERP(col.g),LERP(col.b),LERP(col.a)));
    col4 tex[4]={{0,0,0,1},{0,0,0,1},{0,0,0,1},{0,0,0,1}};
    if(texcfg&1)tex[0]=sample(0,LERP(u0),LERP(v0));
    if(texcfg&2)tex[1]=sample(1,LERP(u1),LERP(v1));
    if(texcfg&4)tex[2]=tc2_from1?sample(2,LERP(u1),LERP(v1)):sample(2,LERP(u2),LERP(v2));
    col4 prev=prim,buf=c4(0,0,0,0),nextbuf=unpack_col(preg[0xfd]);
    for(int st=0;st<6;st++){int r=envbase[st];uint32_t srcs=preg[r],ops=preg[r+1],fns=preg[r+2],scale=preg[r+4];
      if((srcs&0xf000f)==0xf000f&&!(ops&0x7000f)&&!fns&&!(scale&0x30003)&&!(st<4&&(preg[0xe0]>>(8+st)&0x11))){buf=nextbuf;continue;} // passes the previous stage through
      col4 cst=unpack_col(preg[r+3]);
      col4 sa[3];float aa[3];
      for(int k=0;k<3;k++){col4 cs=combine_src(srcs>>(4*k)&15,prim,c4(0,0,0,0),tex,cst,prev,buf);sa[k]=operand_rgb(ops>>(4*k)&15,cs);
        col4 ca=combine_src(srcs>>(16+4*k)&15,prim,c4(0,0,0,0),tex,cst,prev,buf);aa[k]=operand_a(ops>>(12+3*k)&7,ca);}
      int fr=fns&15,fa=fns>>16&15;col4 o;
      if(fr==6||fr==7){float d=4*((sa[0].r-.5f)*(sa[1].r-.5f)+(sa[0].g-.5f)*(sa[1].g-.5f)+(sa[0].b-.5f)*(sa[1].b-.5f));o=c4(d,d,d,0);}
      else{o.r=combine1(fr,sa[0].r,sa[1].r,sa[2].r);o.g=combine1(fr,sa[0].g,sa[1].g,sa[2].g);o.b=combine1(fr,sa[0].b,sa[1].b,sa[2].b);}
      o.a=fr==7?o.r:combine1(fa,aa[0],aa[1],aa[2]);
      float ms=(float)(1<<(scale&3)),as=(float)(1<<(scale>>16&3));o.r*=ms;o.g*=ms;o.b*=ms;o.a*=as;o=cclamp(o);
      prev=o;buf=nextbuf;
      if(st<4){if(preg[0xe0]>>(8+st)&1){nextbuf.r=o.r;nextbuf.g=o.g;nextbuf.b=o.b;}if(preg[0xe0]>>(12+st)&1)nextbuf.a=o.a;}}
    col4 out=prev;
    if(at&1){float ref=(at>>8&255)/255.f;int f=at>>4&7,pass;
      switch(f){case 0:pass=0;break;case 1:pass=1;break;case 2:pass=out.a==ref;break;case 3:pass=out.a!=ref;break;case 4:pass=out.a<ref;break;case 5:pass=out.a<=ref;break;case 6:pass=out.a>ref;break;default:pass=out.a>=ref;}
      if(!pass)continue;}
    if(colorop>>8&1){col4 d=cb_read(x,y),r;int eqr=blendcfg&7,eqa=blendcfg>>8&7,sr=blendcfg>>16&15,dr=blendcfg>>20&15,sa=blendcfg>>24&15,da=blendcfg>>28&15;
      for(int ch=0;ch<3;ch++){float s=(&out.r)[ch]*blend_factor(sr,out,d,blendk,ch,0),t=(&d.r)[ch]*blend_factor(dr,out,d,blendk,ch,0);
        (&r.r)[ch]=eqr==1?s-t:eqr==2?t-s:eqr==3?fminf((&out.r)[ch],(&d.r)[ch]):eqr==4?fmaxf((&out.r)[ch],(&d.r)[ch]):s+t;}
      {float s=out.a*blend_factor(sa,out,d,blendk,3,1),t=d.a*blend_factor(da,out,d,blendk,3,1);r.a=eqa==1?s-t:eqa==2?t-s:eqa==3?fminf(out.a,d.a):eqa==4?fmaxf(out.a,d.a):s+t;}
      out=cclamp(r);}
    cb_write(x,y,out,wmask);}
#undef LERP
}

// ---- vertex loading and drawing ----
static int attr_count(void){return (preg[0x202]>>28)+1;}
static vec4 load_attr(uint32_t addr,uint32_t fmt){int type=fmt&3,n=(fmt>>2&3)+1;vec4 r={0,0,0,1};
  for(int i=0;i<n;i++){float f;switch(type){case 0:f=*(int8_t*)pm(addr+i,4);break;case 1:f=*pm(addr+i,4);break;case 2:f=*(int16_t*)pm(addr+2*i,4);break;default:memcpy(&f,pm(addr+4*i,4),4);}
    *comp(&r,i)=f;}
  return r;}
static int attr_size(uint32_t fmt){static const int sz[4]={1,1,2,4};return sz[fmt&3]*((fmt>>2&3)+1);}
static void run_vertex(uint32_t index,vtx*out){
  vs_state s;memset(&s,0,sizeof s);int na=attr_count();vec4 attr[12];
  uint32_t fmt_lo=preg[0x201],fmt_hi=preg[0x202],base=preg[0x200]<<3;
  for(int i=0;i<12;i++)attr[i]=vs_fixed[i];
  for(int bfi=0;bfi<12;bfi++){uint32_t off=preg[0x203+3*bfi],c1=preg[0x204+3*bfi],c2=preg[0x205+3*bfi];int ncomp=c2>>28,stride=c2>>16&255;
    if(!ncomp)continue;uint32_t at=base+off+index*stride;
    for(int k=0;k<ncomp;k++){uint32_t id=k<8?c1>>(4*k)&15:c2>>(4*(k-8))&15;
      if(id>=12){at+=4*(id-11);continue;}
      uint32_t f=id<8?fmt_lo>>(4*id)&15:fmt_hi>>(4*(id-8))&15;
      if(!(fmt_hi>>(16+id)&1))attr[id]=load_attr(at,f);
      int sz=attr_size(f),al=(f&3)==3?4:(f&3)==2?2:1;at=(at+al-1)&~(uint32_t)(al-1);at+=sz;}}
  uint64_t perm=(uint64_t)preg[0x2bb]|((uint64_t)preg[0x2bc]<<32);
  for(int i=0;i<na&&i<12;i++)s.v[perm>>(4*i)&15]=attr[i];
  vs_run(&s,preg[0x2ba]&0xffff,0,0);
  // outputs -> semantics
  memset(out,0,sizeof*out);out->col=(col4){1,1,1,1};int n=0;uint32_t mask=preg[0x2bd];
  for(int o=0;o<16;o++){if(!(mask>>o&1))continue;if(n>=7)break;uint32_t map=preg[0x50+n++];
    for(int k=0;k<4;k++){int sem=map>>(8*k)&0x1f;float val=*comp(&s.o[o],k);
      switch(sem){case 0:out->pos.x=val;break;case 1:out->pos.y=val;break;case 2:out->pos.z=val;break;case 3:out->pos.w=val;break;
        case 8:out->col.r=val;break;case 9:out->col.g=val;break;case 10:out->col.b=val;break;case 11:out->col.a=val;break;
        case 12:out->u0=val;break;case 13:out->v0=val;break;case 14:out->u1=val;break;case 15:out->v1=val;break;case 16:out->w0=val;break;
        case 22:out->u2=val;break;case 23:out->v2=val;break;}}}}
static void setup_target(void){
  cb_addr=pica_virt(preg[0x11d]<<3);cb_fmt=preg[0x117]>>16&7;uint32_t d=preg[0x11e];cb_w=d&0x7ff;cb_h=(d>>12&0x3ff)+1;
  cb_host=cb_w?p(cb_addr,cb_w*cb_h*(cb_fmt==0?4:cb_fmt==1?3:2)):0;}
static void pica_draw(int indexed){
  pica_draws++;setup_target();if(!cb_w||!cb_h||!cb_host)return;
  if(cb_w*cb_h==240*320&&!getenv("BOTTOM"))return; // only the top screen is shown
  setup_textures();
  uint32_t n=preg[0x228],first=preg[0x22a],mode=preg[0x25e]>>8&3;uint32_t icfg=preg[0x227];
  static vtx vb[65536];if(n>65536)n=65536;
  for(uint32_t i=0;i<n;i++){uint32_t idx=first+i;
    if(indexed){uint32_t ia=(preg[0x200]<<3)+(icfg&0x0fffffff);idx=icfg>>31?*(uint16_t*)pm(ia+2*i,2):*pm(ia+i,1);}
    run_vertex(idx,&vb[i]);}
  if(pica_log>1)fprintf(stderr,"pica draw %u vertices mode %u target %x %ux%u fmt %u v0 %.2f %.2f %.2f %.2f\n",n,mode,cb_addr,cb_w,cb_h,cb_fmt,vb[0].pos.x,vb[0].pos.y,vb[0].pos.z,vb[0].pos.w);
  if(mode==0||mode==3)for(uint32_t i=0;i+2<n;i+=3)raster_tri(&vb[i],&vb[i+1],&vb[i+2]);
  else if(mode==1)for(uint32_t i=0;i+2<n;i++){if(i&1)raster_tri(&vb[i+1],&vb[i],&vb[i+2]);else raster_tri(&vb[i],&vb[i+1],&vb[i+2]);}
  else for(uint32_t i=1;i+1<n;i++)raster_tri(&vb[0],&vb[i],&vb[i+1]);}

static void pica_write(uint32_t id,uint32_t val,uint32_t mask){
  if(id>=0x300)return;
  uint32_t m=(mask&1?0xff:0)|(mask&2?0xff00:0)|(mask&4?0xff0000:0)|(mask&8?0xff000000u:0);
  preg[id]=(preg[id]&~m)|(val&m);val=preg[id];
  switch(id){
  case 0x22e:pica_draw(0);break;
  case 0x22f:pica_draw(1);break;
  case 0x232:fixed_at=val&15;fixed_n=0;break;
  case 0x233:case 0x234:case 0x235:fixed_buf[fixed_n++]=val;if(fixed_n==3){fixed_n=0;if(fixed_at<16)vs_fixed[fixed_at]=unpack24(fixed_buf[0],fixed_buf[1],fixed_buf[2]);}break;
  case 0x2b0:for(int i=0;i<16;i++)vs_bool[i]=val>>i&1;break;
  case 0x2b1:case 0x2b2:case 0x2b3:case 0x2b4:for(int i=0;i<4;i++)vs_int[id-0x2b1][i]=val>>(8*i);break;
  case 0x2c0:vs_c_at=val&0x7f;vs_c_n=0;break;
  case 0x2c1:case 0x2c2:case 0x2c3:case 0x2c4:case 0x2c5:case 0x2c6:case 0x2c7:case 0x2c8:{
    int is32=preg[0x2c0]>>31;vs_c_buf[vs_c_n++]=val;
    if(is32&&vs_c_n==4){float f[4];memcpy(f,vs_c_buf,16);if(vs_c_at<96)vs_c[vs_c_at]=(vec4){f[3],f[2],f[1],f[0]};vs_c_at++;vs_c_n=0;}
    else if(!is32&&vs_c_n==3){if(vs_c_at<96)vs_c[vs_c_at]=unpack24(vs_c_buf[0],vs_c_buf[1],vs_c_buf[2]);vs_c_at++;vs_c_n=0;}
    break;}
  case 0x2cb:vs_code_at=val&0x1ff;break;
  case 0x2cc:case 0x2cd:case 0x2ce:case 0x2cf:case 0x2d0:case 0x2d1:case 0x2d2:case 0x2d3:vs_code[vs_code_at++&511]=val;break;
  case 0x2d5:vs_desc_at=val&0x7f;break;
  case 0x2d6:case 0x2d7:case 0x2d8:case 0x2d9:case 0x2da:case 0x2db:case 0x2dc:case 0x2dd:vs_desc[vs_desc_at++&127]=val;break;
  }}
static void pica_list(uint32_t pa,uint32_t size){
  if(pica_log<0)pica_log=getenv("PICALOG")?atoi(getenv("PICALOG")):0;
  uint32_t a=pa,end=pa+size;
  while(a+8<=end){uint32_t val=*(uint32_t*)pm(a,4),hdr=*(uint32_t*)pm(a+4,4);a+=8;
    uint32_t id=hdr&0xffff,mask=hdr>>16&15,extra=hdr>>20&255,seq=hdr>>31;
    pica_write(id,val,mask);
    for(uint32_t k=0;k<extra;k++){uint32_t v=*(uint32_t*)pm(a,4);a+=4;pica_write(seq?id+k+1:id,v,mask);}
    if(extra&1)a+=4;} // pad to 8 bytes
  }
// ---- GX: memory fill, display transfer, texture copy, DMA ----
static uint32_t top_fb_pa,top_fb_fmt; // the last display transfer to a 240x400 output: the top screen
static void gx_fill(uint32_t start,uint32_t value,uint32_t end,uint32_t ctl){
  if(!start||end<=start)return;int width=(ctl>>8&3); // 0: 16-bit, 1: 24-bit, 2/3: 32-bit
  uint8_t*q=pm(start,end-start);uint32_t n=end-start;
  if(width==0)for(uint32_t i=0;i+2<=n;i+=2)*(uint16_t*)(q+i)=value;
  else if(width==1)for(uint32_t i=0;i+3<=n;i+=3){q[i]=value;q[i+1]=value>>8;q[i+2]=value>>16;}
  else for(uint32_t i=0;i+4<=n;i+=4)*(uint32_t*)(q+i)=value;}
static int px_size(int f){return f==0?4:f==1?3:2;}
static void gx_transfer(uint32_t in,uint32_t out,uint32_t indim,uint32_t outdim,uint32_t flags){
  uint32_t iw=indim&0xffff,ih=indim>>16,ow=outdim&0xffff,oh=outdim>>16,ifmt=flags>>8&7,ofmt=flags>>12&7,scale=flags>>24&3,flip=flags&1,lin2tile=flags>>1&1;
  if(!iw||!ih)return;ow/=scale?2:1;oh/=scale==2?2:1; // the output size is given before scaling
  int ib=px_size(ifmt),ob=px_size(ofmt),hs=scale?2:1,vsc=scale==2?2:1;
  for(uint32_t y=0;y<oh;y++)for(uint32_t x=0;x<ow;x++){
    float acc[4]={0};int cnt=0;
    for(int dy=0;dy<vsc;dy++)for(int dx=0;dx<hs;dx++){
      uint32_t sx=x*hs+dx,sy=y*vsc+dy;if(sx>=iw||sy>=ih)continue;
      uint32_t si=lin2tile?sy*iw+sx:tiled_index(sx,sy,iw);uint8_t*q=pm(in+si*ib,ib);uint32_t c;
      if(ifmt==0)c=q[3]|q[2]<<8|q[1]<<16|(uint32_t)q[0]<<24;else if(ifmt==1)c=q[2]|q[1]<<8|q[0]<<16|0xff000000u;
      else{uint16_t v=q[0]|q[1]<<8;c=ifmt==2?(v>>11&31)*255/31|((v>>6&31)*255/31)<<8|((v>>1&31)*255/31)<<16|(v&1?0xff000000u:0):
        ifmt==3?(v>>11&31)*255/31|((v>>5&63)*255/63)<<8|((v&31)*255/31)<<16|0xff000000u:(v>>12&15)*17|((v>>8&15)*17)<<8|((v>>4&15)*17)<<16|(uint32_t)((v&15)*17)<<24;}
      for(int k=0;k<4;k++)acc[k]+=c>>(8*k)&255;cnt++;}
    if(!cnt)continue;uint32_t c=0;for(int k=0;k<4;k++)c|=(uint32_t)(acc[k]/cnt+.5f)<<(8*k);
    uint32_t oy=flip?oh-1-y:y,oi=lin2tile?tiled_index(x,oy,ow):oy*ow+x;uint8_t*q=pm(out+oi*ob,ob);
    if(ofmt==0){q[3]=c;q[2]=c>>8;q[1]=c>>16;q[0]=c>>24;}else if(ofmt==1){q[2]=c;q[1]=c>>8;q[0]=c>>16;}
    else{uint32_t r=c&255,g=c>>8&255,b=c>>16&255,a=c>>24;uint16_t v=ofmt==2?(r>>3)<<11|(g>>3)<<6|(b>>3)<<1|(a>=128):ofmt==3?(r>>3)<<11|(g>>2)<<5|(b>>3):(r>>4)<<12|(g>>4)<<8|(b>>4)<<4|(a>>4);q[0]=v;q[1]=v>>8;}}
  if(ow==240&&oh==400){top_fb_pa=out;top_fb_fmt=ofmt;}
  if(pica_log>0)fprintf(stderr,"display transfer %x -> %x %ux%u -> %ux%u fmt %u->%u flags %x\n",in,out,iw,ih,ow,oh,ifmt,ofmt,flags);}
static void gx_dma(uint32_t src,uint32_t dst,uint32_t size){ // addresses here are virtual
  if(!size||size>0x1000000)return;memmove(p(dst,size),p(src,size),size);}
static void gx_texcopy(uint32_t in,uint32_t out,uint32_t size,uint32_t indim,uint32_t outdim){
  uint32_t iw=(indim&0xffff)*16,ig=(indim>>16)*16,ow=(outdim&0xffff)*16,og=(outdim>>16)*16;
  if(!iw)iw=size;if(!ow)ow=size;uint32_t done=0,ia=in,oa=out,ir=0,orr=0;
  while(done<size){uint32_t n=1;memcpy(pm(oa,1),pm(ia,1),1);ia+=n;oa+=n;done+=n;ir+=n;orr+=n;
    if(ir==iw){ir=0;ia+=ig;}if(orr==ow){orr=0;oa+=og;}}}
// The top screen as RGB, rotated upright (400x240); returns 0 when nothing was shown yet.
static int pica_top_rgb(uint8_t*rgb){
  if(!top_fb_pa)return 0;
  int b=px_size(top_fb_fmt);for(int y=0;y<240;y++)for(int x=0;x<400;x++){uint8_t*q=pm(top_fb_pa+((uint32_t)x*240+(239-y))*b,b);uint8_t*o=rgb+(y*400+x)*3;
    if(b==4){o[0]=q[3];o[1]=q[2];o[2]=q[1];}else if(b==3){o[0]=q[2];o[1]=q[1];o[2]=q[0];}else{uint16_t v=q[0]|q[1]<<8;o[0]=(v>>11&31)<<3;o[1]=top_fb_fmt==3?(v>>5&63)<<2:(v>>6&31)<<3;o[2]=top_fb_fmt==3?(v&31)<<3:(v>>1&31)<<3;}}
  return 1;}
