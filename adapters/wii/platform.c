#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <math.h>
#include <emscripten.h>
#include "game.h"

// Wii platform backend shared by every minigame. It supplies the platform
// services used by the statically recompiled original functions. There is no
// instruction-fetch interpreter or Wii hardware emulator. Each game's
// adapters/<game>/game.h names the original addresses it needs and any calls
// or behaviour specific to that game. See docs/engine.md.
static uint8_t ram[32*1024*1024];
static uint32_t r[32],lr,ctr,carry;
static uint8_t cr[32];
typedef union {double d;uint64_t u;} FPR;
static FPR f[32];
static uint32_t trace[256];
static uint32_t heap=0x80500000,call_depth;
static uint32_t actors[2048],actor_active[2048],actor_count;
static uint32_t checkers[128],checker_count,events[4096],event_count,frame_number;
static uint32_t scene,layout[8],layout_count,canvas[10],base_canvas;
static uint32_t canvas_timing[10][2];
static uint32_t hits,misses,through,stray,perfect_failed,score_sum,score_count,wrong_count;
// Chart player: the original CTickFlow interpreter (translated with the game)
// runs every chart script live. These stand in for CTickFlowManager.
static uint32_t chart_flows[256],chart_flow_count,chart_rerun,chart_instances,current_flow,music_sound=0xffffffff,music_started,song_ended;
static uint32_t chart_sound,tf_values[16],sound_handle,envelope;
static float frame_ticks; // nominal ticks per 60 Hz frame at the chart's current tempo
static float delta_ticks,current_tempo=GAME_DEFAULT_TEMPO,wrong_timer;
typedef struct {uint32_t count,animations,cells;} Bank;
static Bank banks[256];
EM_JS(void,panic_js,(uint32_t address,uint32_t kind,uint32_t pc,uint32_t stack,uint32_t depth),{console.error(Array.from(HEAPU32.subarray(stack/4,stack/4+depth)).map(x=>x.toString(16)));throw new Error('Original code '+kind+' at 0x'+address.toString(16)+' after 0x'+pc.toString(16));});
#define panic(a,k) panic_js(a,k,lr,(uint32_t)(uintptr_t)trace,call_depth)
static uint32_t idx(uint32_t a){if(a<0x80000000u||a>=0x82000000u)panic(a,1);return a-0x80000000u;}
static uint8_t rd8(uint32_t a){return ram[idx(a)];}
static uint16_t rd16(uint32_t a){uint32_t p=idx(a);return (ram[p]<<8)|ram[p+1];}
static int16_t rds16(uint32_t a){return (int16_t)rd16(a);}
static uint32_t rd32(uint32_t a){uint32_t p=idx(a);return ((uint32_t)ram[p]<<24)|(ram[p+1]<<16)|(ram[p+2]<<8)|ram[p+3];}
static uint64_t rd64(uint32_t a){return ((uint64_t)rd32(a)<<32)|rd32(a+4);}
static float rdf32(uint32_t a){union{uint32_t u;float v;}v={.u=rd32(a)};return v.v;}
static double rdf64(uint32_t a){FPR v={.u=rd64(a)};return v.d;}
static void wr8(uint32_t a,uint32_t v){ram[idx(a)]=v;}
static void wr16(uint32_t a,uint32_t v){uint32_t p=idx(a);ram[p]=v>>8;ram[p+1]=v;}
static void wr32(uint32_t a,uint32_t v){uint32_t p=idx(a);ram[p]=v>>24;ram[p+1]=v>>16;ram[p+2]=v>>8;ram[p+3]=v;}
static void wr64(uint32_t a,uint64_t v){wr32(a,v>>32);wr32(a+4,v);}
static void wrf32(uint32_t a,float x){union{uint32_t u;float v;}v={.v=x};wr32(a,v.u);}
static uint32_t rotl(uint32_t v,uint32_t n){return n?(v<<n)|(v>>(32-n)):v;}
static void cmp(unsigned field,int64_t a,int64_t b){cr[field*4]=a<b;cr[field*4+1]=a>b;cr[field*4+2]=a==b;cr[field*4+3]=0;}
static void fcmp(unsigned field,double a,double b){cr[field*4]=a<b;cr[field*4+1]=a>b;cr[field*4+2]=a==b;cr[field*4+3]=isnan(a)||isnan(b);}
static void call(uint32_t address);
#include "original-functions.inc"
static uint32_t alloc(uint32_t size){uint32_t a=heap;heap=(heap+size+31)&~31u;if(heap>=0x81600000)panic(a,2);return a;}
static void emit(uint32_t kind,uint32_t value,uint32_t extra){if(event_count>=1024)panic(event_count,3);events[event_count*4]=kind;events[event_count*4+1]=value;events[event_count*4+2]=extra;events[event_count*4+3]=frame_number;event_count++;}
static void invoke1(uint32_t address,uint32_t a){r[3]=a;call(address);}
static uint32_t animation(uint32_t actor){uint32_t bank=rd8(actor+12),anim=rd16(actor+14);if(anim>=banks[bank].count)panic(anim,4);return banks[bank].animations+anim*8;}
static uint32_t key(uint32_t actor){uint32_t a=animation(actor),keys=rd32(a+4),count=rd16(a);float frame=rdf32(actor+0x44),total=0;for(uint32_t i=0;i<count;i++){total+=(float)rd16(keys+i*24+2);if(total>frame)return keys+i*24;}return keys+(count?count-1:0)*24;}
static uint32_t total_frames(uint32_t actor){uint32_t a=animation(actor),k=rd32(a+4),n=rd16(a),total=0;for(uint32_t i=0;i<n;i++)total+=rd16(k+i*24+2);return (uint16_t)total;}
static uint32_t create_actor(uint32_t bank,uint32_t anim){
  if(actor_count>=2048)panic(actor_count,5);
  uint32_t a=alloc(256),i=actor_count++;actors[i]=a;actor_active[i]=1;
  r[3]=a;r[4]=bank;r[5]=anim;call(0x801dc21c);
  if(base_canvas){r[3]=a;r[4]=base_canvas;r[5]=0;r[6]=0;call(0x801dcfa4);}
  return a;
}
static void end_actor(uint32_t actor){for(uint32_t i=0;i<actor_count;i++)if(actors[i]==actor)actor_active[i]=0;}
static void set_canvas_timed(uint32_t index,uint32_t type,uint32_t power,float duration,float x,float y){
  float target[2]={x,y};
  for(int axis=0;axis<2;axis++){
    uint32_t t=canvas_timing[index][axis];
    if(!t){t=canvas_timing[index][axis]=alloc(64);invoke1(0x801ea590,t);}
    wr32(t+12,type);wr8(t+16,power);
    float start=rdf32(canvas[index]+0x8c+axis*4);
    r[3]=t;f[1].d=start;f[2].d=target[axis];call(0x801ea698);
    r[3]=t;r[4]=1;f[1].d=0;f[2].d=duration;call(0x801ea550);
  }
}
static void checkpoint(uint32_t category,uint32_t type){
  if(type==0)hits++;else if(type==1)misses++;else through++;
  emit(2,type,category);
}
// CTickFlowManager::fn_801E1CC0: create a flow with the game's own flow class
// and push it at the head of the list, as the original does.
static uint32_t create_flow(uint32_t code,double rest){
  if(chart_flow_count>=256)panic(code,11);
  uint32_t block=alloc(512);r[3]=block;r[4]=code;f[1].d=rest;call(GAME_FLOW_CREATE);
  memmove(chart_flows+1,chart_flows,chart_flow_count*4);chart_flows[0]=block;chart_flow_count++;chart_rerun=1;
  return block;
}
// CTickFlowManager::_18: run every flow once per frame, newest first; rerun
// while a flow spawned another one this frame.
static void run_flows(void){
  for(uint32_t i=0;i<chart_flow_count;i++)wr8(chart_flows[i]+0x20,0);
  do{
    uint32_t list[256],n=chart_flow_count;chart_rerun=0;memcpy(list,chart_flows,n*4);
    for(uint32_t i=0;i<n;i++){
      current_flow=r[3]=list[i];call(0x801dd9e8);
      if(r[3]&1)for(uint32_t j=0;j<chart_flow_count;j++)if(chart_flows[j]==list[i]){chart_flow_count--;memmove(chart_flows+j,chart_flows+j+1,(chart_flow_count-j)*4);break;}
    }
  }while(chart_rerun);
}
// CExFlow::_1C: scene-level chart commands (0x100-0x141). Menus, layouts,
// grading and scene changes are outside the minigame; only what gameplay
// needs is kept. Everything below 0x100 is the original CTickFlow::_1C.
static void exflow_command(void){
  uint32_t self=r[3],op=r[4],arg0=r[5];
  if(op<0x100){
    if(op==0x40||op==0x41){r[3]=0;return;} // Message panes: layout UI is not ported.
    chart_sound=op==0x22||op==0x23;call(0x801ddb84);chart_sound=0;return;
  }
  if(op==0x12a)wr8(0x803201b9,arg0);
  else if(op==0x118&&music_started&&!song_ended){song_ended=1;emit(7,0,rd32(self+0x1c));} // Grading starts: the song is over.
  else if(op==0x121||op==0x131)wr32(self+0x24,0); // Scene version / play-mode queries: normal play.
  r[3]=0;
}
static void call(uint32_t address){
  trace[call_depth]=address;
  if(++call_depth>128)panic(address,6);
  // Game chart commands, with the issuing flow's rest (its tick is the frame's end tick plus that rest).
  if(address==GAME_FLOW_COMMAND&&music_started&&r[4]>=0x200)emit(8,r[4],rd32(r[3]+0x1c));
  if(dispatch_original(address)){call_depth--;return;}
  // Compiler ABI register save/restore helpers.
  if(address>=0x80104100 && address<=0x801041d0){
    if(address>=0x80104184){uint32_t start=14+(address-0x80104184)/4;for(uint32_t i=start;i<32;i++)r[i]=rd32(r[11]-(32-i)*4);}
    else {uint32_t start=14+(address-0x80104138)/4;for(uint32_t i=start;i<32;i++)wr32(r[11]-(32-i)*4,r[i]);}
    call_depth--;return;
  }
  switch(address){
  GAME_CALLS
  case 0x80103b48:{uint32_t a=r[3],ctor=r[4],size=r[6],n=r[7];for(uint32_t i=0;i<n;i++)invoke1(ctor,a+i*size);r[3]=a;break;}
  case 0x801d3284:r[3]=alloc(r[3]);break;
  case 0x801e9144:r[3]=alloc(r[4]);break;
  case 0x801d345c:case 0x801e9150:break;
  case 0x801eaa84:wr32(r[3]+4,0);wr32(r[3]+8,0);break;
  case 0x801eaaa0:break;
  case 0x801dbe7c:{uint32_t bank=r[4],anim=r[5];r[3]=create_actor(bank,anim);break;}
  case 0x801dbfa0:case 0x801dbe24:end_actor(r[4]);break;
  case 0x801dbb58:r[3]=total_frames(r[4]);break;
  case 0x801dbc5c:r[3]=animation(r[4]);break;
  case 0x801dbc7c:r[3]=key(r[4]);break;
  case 0x801dbd38:{uint32_t actor=r[4];r[3]=banks[rd8(actor+12)].cells+rd16(key(actor))*8;break;}
  case 0x801dbe04:case 0x801dbe14:r[3]=1024;break;
  case 0x801dc0d4:break; // Renderer sorts the original layer values.
  case 0x801e2698:case 0x801e3ea8:f[1].d=delta_ticks;break;
#if GAME_CHART_TEMPO
  case 0x801e26b4:f[1].d=(float)(f[1].d/((current_tempo*48.0f)/60.0f));break;
#endif
  case 0x801e2ca8:f[1].d=current_tempo;break;
  case 0x801e4178:r[3]=1;break;
  case 0x801e9158:if(checker_count>=128)panic(checker_count,7);checkers[checker_count++]=r[4];emit(9,r[4],0);break; // new input checker (9): the dry run reads its target tick
  case 0x801e9488:score_sum+=(r[4]?r[4]:wrong_count*5);score_count++;wrong_count=0;break;
  case 0x801eaf2c:checkpoint(r[4],r[5]);break;
  case 0x801e9d68:r[3]=0;break; // Single-controller statistics channel.
  case 0x801e4f60:if(chart_sound)emit(5,r[4],rd32(current_flow+0x1c));else emit(1,r[4],0);break; // Chart sounds (5, with the flow's rest) are scheduled ahead by the browser.
  // Volume, pitch and pan set on a sound just played (10: 0 volume, 1 pitch, 2 pan, as float bits).
  case 0x801e65f4:case 0x801e676c:case 0x801e68e0:{union{float v;uint32_t u;}x={.v=f[1].d};emit(10,address==0x801e65f4?0:address==0x801e676c?1:2,x.u);break;}
  case 0x801e60e0:case 0x801e62b8:case 0x801e6a54:case 0x801e6bc8:break; // Stop and tempo tuning: not yet modelled.
  case 0x80009abc:case 0x80009e98:{uint32_t reason=address==0x80009abc?1:r[3];
    if(address==0x80009abc)wr8(0x803201a0,1);
    if((rd32(0x803201bc)&reason)&&rd8(0x803201b8)&&rd8(0x803201b9)&&!rd8(0x803201ba)){
      wr8(0x803201ba,1);perfect_failed=reason;emit(3,reason,0);
    }break;}
  case 0x80009a9c:case 0x80009e58:break; // Input visualizer / Perfect hit icon.
  case 0x801a7a20:case 0x801a7a90:{ // nw4r::math::SinFIdx / CosFIdx: 256-step table at 0x802dfe70 with deltas
    float x=f[1].d,a=fabsf(x);while(a>65536.0f)a-=65536.0f;uint32_t i=(uint32_t)a&0xffff;float frac=a-(float)i;uint32_t e=0x802dfe70+(i&0xff)*16;
    if(address==0x801a7a20){float v=rdf32(e)+frac*rdf32(e+8);f[1].d=x<0.0f?-v:v;}else f[1].d=rdf32(e+4)+frac*rdf32(e+12);break;}
  case 0x801a7990:f[1].d=(float)(1.0/sqrt(f[1].d));break; // TODO: qualify original FrSqrt approximation.
  case 0x801a7850:f[1].d=expf(f[1].d);break;
  case 0x801a78f0:f[1].d=logf(f[1].d);break;
  case 0x8007bef8:base_canvas=(int32_t)r[4]<0?0:canvas[r[4]];break;
  case 0x8007bf30:{uint32_t actor=r[4],index=r[5];r[3]=actor;r[4]=(int32_t)index<0?0:canvas[index];r[5]=0;r[6]=0;call(0x801dcfa4);break;}
  case 0x8007bf6c:{uint32_t i=r[4];wrf32(canvas[i]+0x8c,f[1].d);wrf32(canvas[i]+0x90,f[2].d);for(int a=0;a<2;a++)if(canvas_timing[i][a])wr8(canvas_timing[i][a]+37,0);break;}
  case 0x8007bfa8:wrf32(canvas[r[4]]+0x84,f[1].d);wrf32(canvas[r[4]]+0x88,f[2].d);break;
  case 0x8007c000:{uint32_t index=r[4],type=r[5],power=r[6];float duration=f[1].d,x=f[2].d,y=f[3].d;set_canvas_timed(index,type,power,duration,x,y);break;}
  case 0x8007c244:{uint32_t i=r[4];union{float f;uint32_t u;}x={.f=rdf32(canvas[i]+0x8c)},y={.f=rdf32(canvas[i]+0x90)};r[3]=x.u;r[4]=y.u;break;}
  case 0x80008160:case 0x8000818c:case 0x8000835c:case 0x80008830:case 0x80008a20:break;
  case 0x8008d290:{uint32_t self=r[3];call(0x801dd6f4);wr32(self,0x802ed598);r[3]=self;break;} // CExFlow ctor
  case 0x8008d310:break;
  case 0x8008d368:exflow_command();break;
  // CTickFlowManager services used by the interpreter.
  case 0x801e4124:r[3]=++chart_instances;break;
  case 0x801e2928:f[1].d=(float)(frame_ticks*f[1].d);break;
  case 0x801e2b9c:case 0x801e2c04:case 0x801e26a8:break; // Tempo and speed follow the backing track (set by the browser clock).
  case 0x801e3938:music_sound=r[4];break; // prepareWave
  case 0x801e3960:music_sound=r[4]; // playWave
  case 0x801e3a5c:if(!music_started){music_started=1;emit(6,music_sound,rd32(current_flow+0x1c));}break; // playPreparedWave: chart tick 0, overshot by -rest
  case 0x801e3e3c:r[3]=1;break; // wave prepared
  case 0x801e4134:tf_values[r[4]&15]=r[5]&0xffff;break; // rest-length slots (TF 0x0a)
  case 0x801e4144:r[3]=tf_values[r[4]&15];break;
  case 0x801e4154:sound_handle=r[4];break;
  case 0x801e415c:r[3]=sound_handle;break;
  case 0x801e7b30:r[3]=0;break; // Handle of a playing sound: tuning is not yet modelled.
  // Sequence/stream music, music stop and fades: the browser plays the one backing track.
  case 0x801e2ed8:case 0x801e2f00:case 0x801e300c:case 0x801e3120:case 0x801e334c:case 0x801e33c0:
  case 0x801e33c8:case 0x801e33f0:case 0x801e34ec:case 0x801e3690:case 0x801e38bc:case 0x801e3c00:case 0x801e3e2c:break;
  case 0x801e38cc:case 0x801e7334:r[3]=0;break; // stream playing / sound data loading
  case 0x801e6e08:case 0x801e6e4c:case 0x801e6ecc:case 0x801e7114:case 0x801e71c0:break; // player volumes
  // Input-check settings (forced inputs, offsets, input recording) and button cooldown: normal play.
  case 0x801e923c:case 0x801e9c30:case 0x801e9c38:case 0x801e9c40:case 0x801e9d58:case 0x801e9d80:case 0x801e9d84:case 0x801d5500:break;
  case 0x8010a084:r[3]=0;break; // sprintf (only for input recording file names)
  case 0x80039e00:case 0x8003a1d0:break; // Balloon text placement is presentation-only.
  case 0x801e73d4:{uint32_t found=0;for(uint32_t i=0;i<162&&!found;i++)if(rd16(0x802e8210+i*8)==(r[4]&0xffff))found=0x802e8210+i*8;r[3]=found;break;} // CSoundManager::find_wave_info over the DOL's wave table
  // Layout transitions (frame decoration); not yet ported.
  case 0x8007263c:case 0x800726ac:case 0x8007271c:case 0x80072794:case 0x8007280c:break;
  // Archive/bank registration is completed by the static browser asset loader.
  case 0x801d3644:case 0x801d369c:case 0x801d3f94:case 0x801d41cc:case 0x801db568:case 0x801ed7d4:case 0x800db700:break;
  case 0x801d422c:r[3]=1;break;
  case 0x801d4270:r[3]=0x80400000;break;
  case 0x801d42e0:case 0x801d42fc:r[3]=1;break;
  case 0x801d5ff0:r[3]=0x80420000;break;
  case 0x801d6aec:break;
  case 0x801d6b2c:if(layout_count>=8)panic(layout_count,9);layout[layout_count++]=r[4];break;
  case 0x801d6c50:r[3]=layout[r[4]];break;
  case 0x801d9a2c:wr32(r[3],0x80430000);break;
  case 0x801e1cc0:r[3]=create_flow(r[4],f[1].d);break;
  case 0x800dc460:case 0x80199b80:break;
  case 0x8000abc4:case 0x8000abcc:case 0x8fff0000:r[3]=0;break; // Explicit platform-only virtual method.
  default:panic(address,10);
  }
  call_depth--;
}

EMSCRIPTEN_KEEPALIVE uint32_t ram_ptr(void){return (uint32_t)(uintptr_t)ram;}
EMSCRIPTEN_KEEPALIVE uint32_t pool_ptr(void){return (uint32_t)(uintptr_t)actors;}
EMSCRIPTEN_KEEPALIVE uint32_t active_ptr(void){return (uint32_t)(uintptr_t)actor_active;}
EMSCRIPTEN_KEEPALIVE uint32_t pool_count(void){return actor_count;}
EMSCRIPTEN_KEEPALIVE uint32_t events_ptr(void){return (uint32_t)(uintptr_t)events;}
EMSCRIPTEN_KEEPALIVE uint32_t events_count(void){return event_count;}
EMSCRIPTEN_KEEPALIVE void events_clear(void){event_count=0;}
EMSCRIPTEN_KEEPALIVE uint32_t allocate(uint32_t size){return alloc(size);}
EMSCRIPTEN_KEEPALIVE void install_bank(uint32_t id,uint32_t count,uint32_t animations,uint32_t cells){banks[id]=(Bank){count,animations,cells};}
EMSCRIPTEN_KEEPALIVE void reset_runtime(void){
  memset(ram,0,sizeof(ram));memset(r,0,sizeof(r));memset(f,0,sizeof(f));memset(cr,0,sizeof(cr));memset(banks,0,sizeof(banks));
  memset(tf_values,0,sizeof(tf_values));sound_handle=envelope=0;
  chart_flow_count=chart_rerun=chart_instances=current_flow=music_started=song_ended=0;music_sound=0xffffffff;frame_ticks=0;heap=0x80500000;call_depth=actor_count=checker_count=event_count=frame_number=layout_count=0;
  hits=misses=through=stray=perfect_failed=score_sum=score_count=wrong_count=0;wrong_timer=0;
  memset(canvas_timing,0,sizeof(canvas_timing));base_canvas=0;
  r[1]=0x81800000;r[2]=0x80328fe0;r[13]=0x80326ec0;
}
EMSCRIPTEN_KEEPALIVE void initialize_scene(void){
  // Instantiate only the service objects used by the minigame component.
  uint32_t globals[]={0x80320148,0x8032016c,0x80320170,0x80320174,0x80320178,0x80320180,0x80320184,0x80320188,0x8032018c,0x80320194};
  uint32_t vtable=alloc(256);for(int i=0;i<64;i++)wr32(vtable+i*4,0x8fff0000);
  for(int i=0;i<10;i++){uint32_t obj=alloc(4096);wr32(globals[i],obj);wr32(obj,vtable);}
  r[3]=2;call(GAME_SCENE_CREATE);scene=r[3];wr32(rd32(0x80320180)+4,scene);wr32(0x80320380,1);
  for(int i=0;i<10;i++){
    canvas[i]=create_actor(255,0);
    if(i){r[3]=canvas[i];r[4]=canvas[i-1];r[5]=0;r[6]=0;call(0x801dcfa4);}
  }
  uint32_t you=create_actor(255,0);wr32(0x80320200,you);wr8(you+0xa7,0);
  uint32_t other=create_actor(255,0);wr32(0x803201f8,other);wr32(0x803201fc,other);
  invoke1(GAME_SCENE_INIT,scene);
  wr32(0x803201bc,7);wr8(0x803201b8,1);
  emit(4,scene,0);
}
EMSCRIPTEN_KEEPALIVE uint32_t scene_address(void){return scene;}
EMSCRIPTEN_KEEPALIVE uint32_t current_key(uint32_t actor){return key(actor);}
#if GAME_CHART_TEMPO
EMSCRIPTEN_KEEPALIVE void set_tempo(float tempo){current_tempo=tempo;}
#endif
EMSCRIPTEN_KEEPALIVE void set_delta(float ticks){delta_ticks=ticks;}
EMSCRIPTEN_KEEPALIVE void set_perfect_active(uint32_t enabled){wr8(0x803201b9,enabled);}
// Start the minigame's chart at its first command.
EMSCRIPTEN_KEEPALIVE void start_chart(uint32_t code){create_flow(code,0);}
EMSCRIPTEN_KEEPALIVE void set_frame_ticks(float ticks){frame_ticks=ticks;}
EMSCRIPTEN_KEEPALIVE uint32_t chart_state(void){return music_started|(song_ended<<1);}
EMSCRIPTEN_KEEPALIVE void begin_frame(void){run_flows();}
// One note's volume envelope from the original nw4r EnvGenerator, as the mixer would apply it:
// amplitude ratios at each 3 ms update, released after release_ms (negative: never). Returns the count.
EMSCRIPTEN_KEEPALIVE uint32_t envelope_curve(int attack,int hold,int decay,int sustain,int release,int release_ms,uint32_t out,uint32_t max){
  if(!envelope)envelope=alloc(32);
  uint32_t env=envelope,n=0;
  r[3]=env;call(0x801b0940);
  r[3]=env;f[1].d=rdf32(0x80329310);call(0x801b09d0); // Reset(VOLUME_INIT)
  r[3]=env;r[4]=attack;call(0x801b0b80);r[3]=env;r[4]=hold;call(0x801b0ba0);r[3]=env;r[4]=decay;call(0x801b0bc0);
  r[3]=env;r[4]=sustain;call(0x801b0c60);r[3]=env;r[4]=release;call(0x801b0c70);
  for(;n<max;n++){
    if(release_ms>=0&&(int)(n*3)>=release_ms)wr32(env,4); // STATUS_RELEASE
    r[3]=env;call(0x801b09f0);call(0x801c5a50);float ratio=f[1].d;wrf32(out+n*4,ratio);
    if(rd32(env)==4&&ratio==0.0f){n++;break;}
    r[3]=env;r[4]=3;call(0x801b0a20);
  }
  return n;
}
// Vanilla fixed-frame A sampling: original checker receives inputAge=0.
// Historical timestamp correction / rollback is FUTURE USE ONLY and inactive.
// See research/timing/FUTURE-USE.md before any later experiment.
EMSCRIPTEN_KEEPALIVE void press_a(void){
  if(!rd8(rd32(0x80320170)+0x429))return; // CInputCheckManager::mAllowInput, set by the chart.
  uint32_t consumed=0;
  for(int i=(int)checker_count-1;i>=0;i--){
    uint32_t c=checkers[i];if(rd8(c+0x71))continue;
    uint32_t quality=0x80400000;r[3]=c;r[4]=quality;r[5]=wrong_timer>0;f[1].d=0;
    call(rd32(rd32(c)+0x20));uint32_t judgment=r[3];
    if(judgment<=1){
      consumed=1;r[3]=c;r[4]=4;call(rd32(rd32(c)+(judgment==0?0x24:0x28)));
      if(r[3]){uint32_t grade=rd8(quality);score_sum+=grade;score_count++;wrong_count=0;checkpoint(rd8(c+0x78),judgment);
#if GAME_END_CHECKER_ON_HIT
        if(rd8(c+0x70)){invoke1(rd32(rd32(c)+0x14),c);checker_count--;memmove(checkers+i,checkers+i+1,(checker_count-i)*4);}
#endif
      }
    }
  }
  if(!consumed){r[3]=4;call(GAME_WRONG_INPUT);stray++;wrong_timer=48;wrong_count=wrong_count<6?wrong_count+1:6;}
}
EMSCRIPTEN_KEEPALIVE void finish_frame(void){
  for(int i=(int)checker_count-1;i>=0;i--){
    uint32_t c=checkers[i];invoke1(rd32(rd32(c)+0x18),c);
    if(r[3]){invoke1(rd32(rd32(c)+0x14),c);checker_count--;memmove(checkers+i,checkers+i+1,(checker_count-i)*4);}
  }
  if(wrong_timer>0){wrong_timer-=delta_ticks;if(wrong_timer<0)wrong_timer=0;}
  for(int i=0;i<10;i++)for(int a=0;a<2;a++){uint32_t t=canvas_timing[i][a];if(t&&rd8(t+37)){r[3]=t;r[4]=0;call(0x801e9de8);wrf32(canvas[i]+0x8c+a*4,rdf32(t+40));}}
  invoke1(GAME_SCENE_UPDATE,scene);
  for(uint32_t i=0;i<actor_count;i++)if(actor_active[i]){invoke1(0x801dc314,actors[i]);if(r[3])actor_active[i]=0;}
  GAME_AFTER_UPDATE
  frame_number++;
}
EMSCRIPTEN_KEEPALIVE uint32_t stat(uint32_t id){switch(id){case 0:return hits;case 1:return misses;case 2:return through;case 3:return stray;case 4:return perfect_failed;case 5:return frame_number;case 6:return checker_count;case 7:return score_sum;case 8:return score_count;}return 0;}
EMSCRIPTEN_KEEPALIVE uint32_t invoke_original(uint32_t address,uint32_t a,uint32_t b,uint32_t c,uint32_t d,float f1,float f2,float f3){r[3]=a;r[4]=b;r[5]=c;r[6]=d;f[1].d=f1;f[2].d=f2;f[3].d=f3;call(address);return r[3];}
