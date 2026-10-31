// GPU work for WebGL (web/gl.mjs): with GL=1 the rasterizer here draws nothing. Each draw records its
// triangles (after the vertex shader) and the pixel state it needs; textures are decoded here to RGBA8
// once per content change; memory fills and the top-screen display transfer become clear and present
// commands. The page runs the commands each vblank (gl_cmd, gl_vtx), then they start over.
enum{GL_FILL=1,GL_TEX,GL_DRAW,GL_PRESENT};
static int pica_gl=-1;
static uint32_t gl_cmd[1<<16],gl_ncmd;static float gl_vtx[13*(1<<17)];static uint32_t gl_nvtx,gl_draw_at,gl_frame;
static uint8_t gl_rgba[16<<20];static uint32_t gl_rgba_used; // decoded textures for this vblank's uploads
static struct{uint32_t addr,fmt,w,h,frame;uint64_t hash;}gl_tex[256];static int gl_ntex;
static uint64_t gl_hash(const uint8_t*d,uint32_t n){uint64_t h=1469598103934665603ull;uint32_t i=0;
  for(;i+8<=n;i+=8){uint64_t v;memcpy(&v,d+i,8);h=(h^v)*1099511628211ull;}for(;i<n;i++)h=(h^d[i])*1099511628211ull;return h;}
static void gl_reset(void){gl_ncmd=gl_nvtx=gl_rgba_used=0;gl_frame++;}
// The texture id for unit u (0 = none), uploading it when it is new or its bytes changed.
static uint32_t gl_texture(int u){
  texunit*t=&tu[u];if(!t->base||!t->w||!t->h||t->w>1024||t->h>1024)return 0;
  static const uint32_t bits[14]={32,24,16,16,16,16,16,8,8,8,4,4,4,8};uint32_t size=t->w*t->h*bits[t->fmt<14?t->fmt:0]/8;
  int i;for(i=0;i<gl_ntex;i++)if(gl_tex[i].addr==t->addr&&gl_tex[i].fmt==t->fmt&&gl_tex[i].w==t->w&&gl_tex[i].h==t->h)break;
  if(i==gl_ntex){if(gl_ntex==256)i=gl_frame%256;else gl_ntex++;gl_tex[i].addr=t->addr;gl_tex[i].fmt=t->fmt;gl_tex[i].w=t->w;gl_tex[i].h=t->h;gl_tex[i].frame=0;gl_tex[i].hash=0;}
  if(gl_tex[i].frame!=gl_frame){gl_tex[i].frame=gl_frame;uint64_t h=gl_hash(t->base,size);
    if(h!=gl_tex[i].hash&&gl_rgba_used+t->w*t->h*4<=sizeof gl_rgba&&gl_ncmd+5<=sizeof gl_cmd/4){gl_tex[i].hash=h;
      uint32_t*o=(uint32_t*)(gl_rgba+gl_rgba_used); // row y holds the texels at PICA t = (y + 0.5) / h
      for(uint32_t y=0;y<t->h;y++)for(uint32_t x=0;x<t->w;x++)o[y*t->w+x]=tex_fetch(t->base,t->fmt,t->w,t->h,x,y);
      gl_cmd[gl_ncmd++]=GL_TEX;gl_cmd[gl_ncmd++]=i+1;gl_cmd[gl_ncmd++]=t->w;gl_cmd[gl_ncmd++]=t->h;gl_cmd[gl_ncmd++]=(uint32_t)(uintptr_t)o;
      gl_rgba_used+=t->w*t->h*4;}}
  return i+1;}
static void gl_tri(vtx*a,vtx*b,vtx*c){
  if(gl_nvtx+3>sizeof gl_vtx/4/13)return;vtx*v[3]={a,b,c};
  for(int i=0;i<3;i++){float*o=gl_vtx+13*gl_nvtx++;vtx*s=v[i];
    o[0]=s->pos.x;o[1]=s->pos.y;o[2]=s->pos.w;o[3]=s->col.r;o[4]=s->col.g;o[5]=s->col.b;o[6]=s->col.a;
    o[7]=s->u0;o[8]=s->v0;o[9]=s->u1;o[10]=s->v1;o[11]=s->u2;o[12]=s->v2;}}
static void gl_begin_draw(void){gl_draw_at=gl_nvtx;}
// One draw: target, vertex range, then the registers the pixel stage reads (see gl.mjs for the layout).
static void gl_end_draw(void){
  if(gl_nvtx==gl_draw_at||gl_ncmd+128>sizeof gl_cmd/4)return;
  uint32_t ids[3];for(int u=0;u<3;u++)ids[u]=preg[0x80]>>u&1?gl_texture(u):0;
  uint32_t*c=gl_cmd+gl_ncmd;int n=0;
  c[n++]=GL_DRAW;c[n++]=cb_addr;c[n++]=cb_w;c[n++]=cb_h;c[n++]=gl_draw_at;c[n++]=gl_nvtx-gl_draw_at;
  c[n++]=preg[0x41];c[n++]=preg[0x43];c[n++]=preg[0x68];c[n++]=preg[0x65];c[n++]=preg[0x66];c[n++]=preg[0x67];c[n++]=preg[0x80];
  for(int u=0;u<3;u++){c[n++]=ids[u];c[n++]=tu[u].param;c[n++]=tu[u].border;}
  for(int r=0xc0;r<=0x107;r++)c[n++]=preg[r];
  gl_ncmd+=n;}
static void gl_fill(uint32_t start,uint32_t end,uint32_t value,uint32_t width){
  if(gl_ncmd+5>sizeof gl_cmd/4)return;
  gl_cmd[gl_ncmd++]=GL_FILL;gl_cmd[gl_ncmd++]=pica_virt(start);gl_cmd[gl_ncmd++]=pica_virt(end);gl_cmd[gl_ncmd++]=value;gl_cmd[gl_ncmd++]=width;}
static void gl_present(uint32_t in,uint32_t flags){
  if(gl_ncmd+3>sizeof gl_cmd/4)return;gl_cmd[gl_ncmd++]=GL_PRESENT;gl_cmd[gl_ncmd++]=pica_virt(in);gl_cmd[gl_ncmd++]=flags;}
