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
// CInputCheckManager::unk4A4: the chart can remap an input type (fn_801E9D58), e.g. A to the
// A+B type (6) a checker waits for.
static uint32_t input_map[256];
// A+B detection state (CController::unk1370, unk1374, unk136C, unk136D) and lone presses held back.
static uint32_t combo_state,combo_frames,combo_down,combo_was_down,held_a,held_b,release_a,release_b;
static uint32_t checkers[128],checker_count,events[5120],event_count,frame_number;
static uint32_t scene,layout[8],layout_count,canvas[10],base_canvas;
static uint32_t canvas_timing[10][2];
static uint32_t hits,misses,through,stray,perfect_failed,score_sum,score_count,wrong_count;
// Chart player: the original CTickFlow interpreter (translated with the game)
// runs every chart script live. These stand in for CTickFlowManager.
static uint32_t chart_flows[256],chart_flow_count,chart_rerun,chart_instances,current_flow,music_sound=0xffffffff,music_started,song_ended;
static uint32_t chart_sound,tf_values[16],sound_handle,envelope;
static float frame_ticks; // nominal ticks per 60 Hz frame at the chart's current tempo
static float delta_ticks,current_tempo,wrong_timer,speed=1;
// Cell animations that follow the chart tempo (CCellAnimManager::setTempoUpdate).
static uint32_t anim_tempo_update,anim_tempo;
// Sound handles the game keeps (an SNDHandle in its own data): each gets a stand-in sound object
// so the game sees it attached; the browser plays and tunes the real sound by handle address.
static uint32_t handle_sounds[64][2],handle_count,chart_handles;
static uint32_t grading,grading_ready,grading_pressed,message_table,message_count,grading_scene,grading_done,prompt_press,prompt_release;
static uint32_t prompt_exit_frames,prompt_exit_remaining;
// Scene manager (CGameManager::_1C, CScene::fn_801D83DC, CFaderFlash): a remix changes scene in the
// middle of its chart. Scene states as CScene's; the fader waits 5 frames and then 2 (Wait1, Wait2).
enum{SCENE_INITIAL,SCENE_LOADING,SCENE_READY,SCENE_ACTIVE,SCENE_SCHEDULE_DOWN,SCENE_DOWN,SCENE_DEAD};
enum{FADER_IDLE=0,FADER_WAIT1=2,FADER_WAIT2=3};
static uint32_t profile_index,next_profile,next_chart,scene_state,fader_state,fader_wait,flow_create_fn;
// The platform's own cell animations (canvases, Perfect markers) outlive every scene.
static uint32_t persistent[16],persistent_count;
// Cell-animation banks: every bank of every scene is installed up front (install_bank); a scene's
// registBank call puts one under the id it asks for, found by the file name it read.
typedef struct {uint32_t scene,count,animations,cells;char name[48];} NamedBank;
static NamedBank named_banks[64];
static uint32_t named_bank_count,file_names[512],file_count;
void finish_frame(void);
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
// Each scene's original addresses, from adapters/<game>/game.h (a remix lists several; see
// tools/recompile.py). id: the original ESceneID a remix's chart names; version: where the scene
// keeps its version (CSceneManager::fn_8008A4DC).
typedef struct{uint32_t id,version,create,init,update,flow_command,wrong_input,flow_create,end_on_hit;void(*after_update)(void);} SceneProfile;
#ifdef GAME_SCENE_PROFILES
GAME_SCENE_PROFILES
#else
#define GAME_SCENE_COUNT 1
static void after_update_0(void){GAME_AFTER_UPDATE}
static const SceneProfile profiles[1]={{0xffffffffu,0,GAME_SCENE_CREATE,GAME_SCENE_INIT,GAME_SCENE_UPDATE,GAME_FLOW_COMMAND,GAME_WRONG_INPUT,GAME_FLOW_CREATE,GAME_END_CHECKER_ON_HIT,after_update_0}};
#endif
static int find_profile(uint32_t id){for(int i=0;i<GAME_SCENE_COUNT;i++)if(profiles[i].id==id)return i;return -1;}
static int is_flow_command(uint32_t address){for(int i=0;i<GAME_SCENE_COUNT;i++)if(profiles[i].flow_command==address)return 1;return 0;}
// Events for the browser: kind, value, extra (usually the issuing flow's rest), frame, and a
// sound handle address for sound events (0: the sound played last, as in CSoundManager::tune).
static void emit_handle(uint32_t kind,uint32_t value,uint32_t extra,uint32_t handle){if(event_count>=1024)panic(event_count,3);uint32_t*e=events+event_count*5;e[0]=kind;e[1]=value;e[2]=extra;e[3]=frame_number;e[4]=handle;event_count++;}
static void emit(uint32_t kind,uint32_t value,uint32_t extra){emit_handle(kind,value,extra,0);}
// Message events (15) for web/engine/message.mjs: value = field<<8 | message pane (the chart's
// access index), extra = the field's value. A layout that owns text boxes (CBalloonLayout,
// Hole in One's CMyLayout) is announced when the scene adds it; MESG_CLEAR drops them all when
// the scene ends. MESG_REGISTER gives a pane a text box (CTickFlow::fn_801DEF58): 0 none,
// 0x10 the balloon (with its window), 0x11 the balloon's text alone, 0x12 the overlay strip,
// 0x20+i Hole in One's message i.
enum{MESG_VISIBLE,MESG_TEXT,MESG_STRING,MESG_REGISTER,MESG_LAYOUT,MESG_CLEAR,MESG_TAIL,
  MESG_BOX_X,MESG_BOX_Y,MESG_BOX_W,MESG_BOX_H,MESG_TAIL_X,MESG_TAIL_Y,MESG_OVERLAY_Y,MESG_OVERLAY_H};
enum{MESG_LAYOUT_BALLOON=1,MESG_LAYOUT_GOLF=2};
static uint32_t fbits(float x){union{float v;uint32_t u;}b={.v=x};return b.u;}
// The rest of the flow running now; 0 outside the chart (a press, a scene update).
static uint32_t flow_rest(void){return current_flow?rd32(current_flow+0x1c):0;}
// Attach a stand-in sound object to a handle the game passed to play() (nw4r SoundHandle::mSound, its first word).
static void attach(uint32_t handle){
  for(uint32_t i=0;i<handle_count;i++)if(handle_sounds[i][0]==handle){wr32(handle,handle_sounds[i][1]);return;}
  if(handle_count>=64)panic(handle,12);
  uint32_t sound=alloc(64);handle_sounds[handle_count][0]=handle;handle_sounds[handle_count++][1]=sound;wr32(handle,sound);
}
static uint32_t handle_of(uint32_t sound){for(uint32_t i=0;i<handle_count;i++)if(handle_sounds[i][1]==sound)return handle_sounds[i][0];panic(sound,13);return 0;}
// CSoundManager::get_wave_tempo: the first tempo entry of the wave's info in the DOL table.
static float wave_tempo(uint32_t sid){
  for(uint32_t i=0;i<162;i++){uint32_t w=0x802e8210+i*8;if(rd16(w)==sid){uint32_t t=rd32(w+4);return (float)rd32(t)*rd16(w+2)*60.0f/rd32(t+4);}}
  panic(sid,14);return 0;
}
static void invoke1(uint32_t address,uint32_t a){r[3]=a;call(address);}
static uint32_t animation(uint32_t actor){uint32_t bank=rd8(actor+12),anim=rd16(actor+14);if(anim>=banks[bank].count)panic(anim,4);return banks[bank].animations+anim*8;}
static uint32_t key(uint32_t actor){uint32_t a=animation(actor),keys=rd32(a+4),count=rd16(a);float frame=rdf32(actor+0x44),total=0;for(uint32_t i=0;i<count;i++){total+=(float)rd16(keys+i*24+2);if(total>frame)return keys+i*24;}return keys+(count?count-1:0)*24;}
static uint32_t total_frames(uint32_t actor){uint32_t a=animation(actor),k=rd32(a+4),n=rd16(a),total=0;for(uint32_t i=0;i<n;i++)total+=rd16(k+i*24+2);return (uint16_t)total;}
static uint32_t create_actor(uint32_t bank,uint32_t anim){
  if(actor_count>=2048)panic(actor_count,5);
  uint32_t a=alloc(256),i=actor_count++;actors[i]=a;actor_active[i]=1;
  r[3]=a;r[4]=bank;r[5]=anim;call(0x801dc21c);
  wr8(a+0xae,anim_tempo_update);wr16(a+0x50,anim_tempo); // as CCellAnimManager::createCellAnim
  if(base_canvas){r[3]=a;r[4]=base_canvas;r[5]=0;r[6]=0;call(0x801dcfa4);}
  return a;
}
// CCellAnimManager::endCellAnim: the animation leaves its base's list and its own attachments lose
// their base (clearBaseData), so no list reaches an ended animation.
static void end_actor_at(uint32_t i){
  uint32_t a=actors[i];if(!actor_active[i])return;
  if(rd32(a+0xb0)){r[3]=a;r[4]=0;r[5]=0;r[6]=0;call(0x801dcfa4);}
  for(uint32_t c=rd32(a+0xb4),next;c;c=next){next=rd32(c+0xb8);wr32(c+0xb0,0);wr32(c+0xb8,0);wr32(c+0xbc,0);}
  actor_active[i]=0;
}
static void end_actor(uint32_t actor){for(uint32_t i=0;i<actor_count;i++)if(actors[i]==actor)end_actor_at(i);}
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
static uint32_t message(uint32_t id){
  for(uint32_t i=0;i<message_count;i++)if(rd32(message_table+i*8)==id)return rd32(message_table+i*8+4);
  panic(id,12);return 0;
}
static uint32_t message_id(uint32_t p){uint32_t id=0;for(;rd8(p);p++){uint32_t c=rd8(p);if(c<'0'||c>'9')panic(p,12);id=id*10+c-'0';}return id;}
// CMessageManager::fn_80087708: a message id string is seven digits (Tap Trial's has a trailing
// space); 0xffffffff if not.
static uint32_t bmg_id(uint32_t s){uint32_t v=0;for(int i=0;i<7;i++){uint8_t c=rd8(s+i);if(c<'0'||c>'9')return 0xffffffff;v=v*10+c-'0';}return v;}
static void enter_grading(void){
  uint32_t cp=rd32(0x8032016c),gs=alloc(256);grading_scene=gs;grading=1;grading_ready=grading_pressed=0;
  wr32(rd32(0x80320180)+4,gs);wr32(gs+0x34,alloc(256));wr32(gs+0x38,rd32(cp+0x2fc));wr8(gs+0x3c,rd8(cp+0xdf));
}
// CTickFlowManager::fn_801E1CC0: create a flow with the game's own flow class
// and push it at the head of the list, as the original does.
static uint32_t create_flow(uint32_t code,double rest){
  if(chart_flow_count>=256)panic(code,11);
  uint32_t block=alloc(512);r[3]=block;r[4]=code;f[1].d=rest;call(grading?0x8000b888:flow_create_fn?flow_create_fn:profiles[profile_index].flow_create);
  memmove(chart_flows+1,chart_flows,chart_flow_count*4);chart_flows[0]=block;chart_flow_count++;chart_rerun=1;
  return block;
}
// CTickFlowManager::_1C (registerFlow): later flows use this class, and every running flow is
// recreated as one with its state copied (createTickFlowDerive, CTickFlow::_18).
static void register_flow(uint32_t create){
  flow_create_fn=create;
  for(uint32_t i=0;i<chart_flow_count;i++){
    uint32_t old=chart_flows[i],block=alloc(512);
    r[3]=block;r[4]=0;f[1].d=0;call(create);uint32_t flow=r[3];
    r[3]=old;r[4]=flow;call(rd32(rd32(old)+0x18));chart_flows[i]=flow;
  }
}
// CTickFlowManager::fn_801E2490: end the flows of a higher category.
static void end_flows_above(int32_t category){
  for(uint32_t j=0;j<chart_flow_count;)if((int32_t)rd32(chart_flows[j]+0x14)>category){chart_flow_count--;memmove(chart_flows+j,chart_flows+j+1,(chart_flow_count-j)*4);}else j++;
}
// CCellAnimManager::registBank: the bank in the brcad file the scene read (by name, "./robot.brcad").
static void register_bank(uint32_t file,uint32_t id){
  uint32_t i=(file-0x80410000)/32;if(file<0x80410000||i>=file_count)panic(file,16);
  char name[48];uint32_t p=file_names[i],n=0;if(rd8(p)=='.'&&rd8(p+1)=='/')p+=2;
  while(rd8(p)&&rd8(p)!='.'&&n<47)name[n++]=rd8(p++);name[n]=0;
  for(uint32_t b=0;b<named_bank_count;b++)if(named_banks[b].scene==profile_index&&!strcmp(named_banks[b].name,name)){
    banks[id]=(Bank){named_banks[b].count,named_banks[b].animations,named_banks[b].cells};emit(25,id,b);return;
  }
  panic(file_names[i],17);
}
static void canvas_default(uint32_t i){
  wrf32(canvas[i]+0x84,0);wrf32(canvas[i]+0x88,0);wrf32(canvas[i]+0x8c,1);wrf32(canvas[i]+0x90,1);wrf32(canvas[i]+0x94,0);
  for(int a=0;a<2;a++)if(canvas_timing[i][a])wr8(canvas_timing[i][a]+37,0);
}
// CExScene::_20, the end of every scene: what the next scene would otherwise inherit is reset
// (canvases, input checkers, the chart's input remaps and the layouts), flows above category 0 end
// and the rest carry on as plain CExFlows until the next scene registers its own class.
static void ex_scene_unload(void){
  base_canvas=canvas[2];for(uint32_t i=2;i<=9;i++)canvas_default(i);
  checker_count=0;for(int i=0;i<256;i++)input_map[i]=i;
  layout_count=0;emit(15,MESG_CLEAR<<8,0); // CLayoutManager::fn_801D6BB0
  end_flows_above(0);register_flow(0x8008d2cc);
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
  current_flow=0;
}
// CExFlow::_1C: scene-level chart commands (0x100-0x141). Menus, layouts,
// grading and scene changes are outside the minigame; only what gameplay
// needs is kept. Everything below 0x100 is the original CTickFlow::_1C.
static void exflow_command(void){
  uint32_t self=r[3],op=r[4],arg0=r[5],args=r[6],cp=rd32(0x8032016c);
  if(op<0x100){
    if(grading&&op==0x46){if(arg0==1){grading_ready=1;grading_pressed=0;prompt_press=rd32(args+4);prompt_release=rd32(args+8);emit(20,5,rd32(self+0x1c));}else if(arg0==2)wr32(self+0x24,grading_pressed==2?0:1);r[3]=0;return;}
    // Message panes (CTickFlow's lbl_803D5D38 text boxes): shown or hidden with their container,
    // or given a string from the chart. Message events (15) for web/engine/message.mjs.
    if(op==0x40){emit(15,(MESG_VISIBLE<<8)|(arg0&255),rd32(args)!=0);r[3]=0;return;}
    if(op==0x41){emit(15,(MESG_STRING<<8)|(arg0&255),rd32(args));r[3]=0;return;}
    chart_sound=op==0x22||op==0x23;call(0x801ddb84);chart_sound=0;return;
  }
  if(op==0x118&&arg0<=1){
    uint32_t criteria=rd32(args);
    if(arg0==1){uint32_t copy=alloc(9*16);for(uint32_t i=0;i<9;i++){
      memcpy(ram+idx(copy+i*16),ram+idx(criteria+i*16),16);
      if(rd16(copy+i*16+14)&0x8000)break;
      for(int j=0;j<2;j++){uint32_t id=rd32(copy+i*16+j*4);if(id)wr32(copy+i*16+j*4,message(message_id(id)));}
    }criteria=copy;}
    r[3]=cp;r[4]=criteria;call(0x801eae6c);invoke1(0x801eaea4,cp);
  }
  else if(op==0x118&&arg0==2&&music_started&&!song_ended){song_ended=1;emit(7,0,rd32(self+0x1c));}
  else if(op==0x119)wr8(cp+0xc5,rd32(args));
  else if(op==0x11a)wr8(cp+0xdd,rd32(args)!=0);
  else if(op==0x11b){wr32(cp+0xcc,rd32(args));wr32(cp+0xd0,rd32(args));}
  else if(op==0x11c){r[3]=cp;f[1].d=(int32_t)rd32(args);call(0x801eb10c);}
  else if(op==0x11d){if(arg0==0)invoke1(0x801eb130,cp);else wr32(self+0x24,rd32(cp+0x2fc));}
  else if(song_ended&&op==0x100&&arg0==0&&rd32(args)==0x39){enter_grading();emit(20,9,rd32(self+0x1c));}
  else if(song_ended&&op==0x100&&arg0==0&&rd32(args)==0x38){grading=2;grading_ready=0;emit(20,10,rd32(self+0x1c));}
  else if(grading==2&&op==0x100&&arg0==1){grading_done=1;emit(20,11,rd32(self+0x1c));}
  else if(grading&&op==0x104)wr32(self+0x24,1);
  // A remix changes scene (CSceneManager::fn_80089FE0 then CGameManager::_20), sets the next
  // scene's version and asks whether it runs yet (CScene::eState_Active).
  else if(op==0x100&&arg0==0&&!song_ended&&find_profile(rd32(args))>=0){
    next_profile=find_profile(rd32(args));next_chart=rd32(args+4);
    scene_state=SCENE_SCHEDULE_DOWN;fader_state=FADER_WAIT1;fader_wait=5; // CScene::fn_801D8578, CFaderFlash::_10
  }
  else if(op==0x101&&find_profile(rd32(args))>=0)wr32(profiles[find_profile(rd32(args))].version,rd32(args+4));
  else if(op==0x102&&find_profile(rd32(args))>=0){} // Scene assets: the browser loaded every scene's up front.
  else if(op==0x104)wr32(self+0x24,scene_state==SCENE_ACTIVE);
  // Ticks spent waiting for the next scene (a static at r13-27216, from the constant at r2-15420),
  // taken off the flow's rest so the chart keeps to the music.
  else if(op==0x130){
    const uint32_t ticks=0x80326ec0-27216;
    if(arg0==0)wrf32(ticks,rdf32(0x80328fe0-15420));
    else if(arg0==1)wrf32(ticks,rdf32(ticks)+(float)rd32(args));
    else if(arg0==2)wrf32(self+0x1c,rdf32(self+0x1c)-rdf32(ticks));
  }
  else if(grading&&op==0x12f&&arg0==1)wr32(self+0x24,0);
  // Sound heap loads and frees (fn_8008364C, fn_80083668, fn_800836C0): the browser decoded every
  // group up front. fn_800836E0 only keeps its flag.
  else if(op>=0x12c&&op<=0x12e){}
  else if(op==0x12f&&arg0==0)wr8(0x80326ec0-27264,rd32(args)!=0);
  // CExScene::updatePerfectStatus returns at once outside the Perfect campaign, which is not ported.
  else if(op==0x129&&!rd8(0x80326ec0-27912)){}
  else if(op==0x124)emit(15,(MESG_TEXT<<8)|(arg0&255),bmg_id(rd32(args))); // CMessageManager::fn_80088FEC(pane, fn_80087708(id))
  else if(grading&&op==0x123){
    if(arg0==0)emit(16,0,rd32(args));
    else if(arg0==1){prompt_exit_remaining=prompt_exit_frames;emit(16,1,prompt_exit_frames);}
    else if(arg0==2)wr32(self+0x24,prompt_exit_remaining==0);
  }
  else if(song_ended&&op==0x10a){emit(20,arg0?6:7,rd32(self+0x1c));emit(22,arg0,rd32(args)?rd32(args+4):(uint32_t)((float)rd32(args+4)*60/(current_tempo*.8f)));}
  else if(op==0x12a)wr8(0x803201b9,arg0);
  else if(op==0x121||op==0x131)wr32(self+0x24,0); // Scene version / play-mode queries: normal play.
  r[3]=0;
}
static void call(uint32_t address){
  trace[call_depth]=address;
  if(++call_depth>128)panic(address,6);
  // Game chart commands, with the issuing flow's rest (its tick is the frame's end tick plus that rest).
  if(music_started&&r[4]>=0x200&&is_flow_command(address))emit(8,r[4],rd32(r[3]+0x1c));
  if(grading&&is_flow_command(address)){wr32(r[3]+0xfc,grading_scene);call(0x8000b930);call_depth--;return;}
  if(address==0x801eaf2c)checkpoint(r[4],r[5]);
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
  case 0x801e26b4:f[1].d=(float)(f[1].d/(current_tempo*speed*48.0f/(60.0f*60.0f)));break; // ticks to frames
  case 0x801e2ca8:f[1].d=current_tempo*speed;break;
  case 0x801e4178:r[3]=1;break;
  case 0x801e9158:if(checker_count>=128)panic(checker_count,7);checkers[checker_count++]=r[4];emit(9,r[4],0);break; // new input checker (9): the dry run reads its target tick
  case 0x801e9488:score_sum+=(r[4]?r[4]:wrong_count*5);score_count++;wrong_count=0;break;
  case 0x801e9d58:input_map[r[4]&255]=r[5];break;
  case 0x801e9c40:for(int i=0;i<256;i++)input_map[i]=i;break;
  case 0x80004714:memset(ram+idx(r[3]),r[4],r[5]);break;
  case 0x8010ce1c:{uint32_t n=0;while(rd16(r[3]+n*2))n++;r[3]=n;break;}
  case 0x8010ce98:{uint32_t dest=r[3],src=r[4],n=0;while(rd16(dest+n*2))n++;for(uint32_t j=0;;j++){uint16_t c=rd16(src+j*2);wr16(dest+(n+j)*2,c);if(!c)break;}break;}
  case 0x8000c088:emit(20,0,rd32(current_flow+0x1c));break;
  case 0x8000c0b4:emit(20,1,rd32(current_flow+0x1c));break;
  case 0x8000c15c:emit(20,2,rd32(current_flow+0x1c));break;
  case 0x8000c0f4:emit(20,4,rd32(current_flow+0x1c));break;
  case 0x801e9d68:r[3]=0;break; // Single-controller statistics channel.
  // CSoundManager::play(id, start, handle): a chart sound (5), a game sound a chart command
  // played (12) or one from a press or the scene's own update (1).
  // A start below 0 delays the sound by that many ticks; above 0 it starts that many ticks in.
  case 0x801e4f60:{uint32_t handle=r[5];if(handle)attach(handle);
    emit_handle(chart_sound?5:current_flow?12:1,r[4],flow_rest(),handle);if(f[1].d!=0)emit(10,3,fbits(f[1].d));break;}
  // Tuning (10): value = type | fade frames << 8 (0 volume, 1 pitch, 2 pan, 3 start, 4 stop,
  // 5 pause), extra = float bits (pause: 1 or 0), on the handle's sound or the one played last.
  case 0x801e65f4:emit_handle(10,0|r[4]<<8,fbits(f[1].d),r[5]);break;
  case 0x801e676c:emit_handle(10,1,fbits(f[1].d),r[4]);break;
  case 0x801e68e0:emit_handle(10,2,fbits(f[1].d),r[4]);break;
  case 0x801e62b8:emit_handle(10,4|r[4]<<8,0,r[5]);break;
  case 0x801e6440:emit_handle(10,5|r[5]<<8,r[4]&1,r[6]);break;
  case 0x801ad8b0:wr8(r[3],r[4]&1);emit_handle(10,5|r[5]<<8,r[4]&1,handle_of(r[3]));break; // nw4r BasicSound::Pause on a game handle
  case 0x801adb10:r[3]=rd8(r[3]);break; // BasicSound::IsPause
  case 0x801e60e0:case 0x801e6a54:case 0x801e6bc8:break; // Sequence tempo ratio: listed sequences follow the chart tempo (see audio.mjs).
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
  case 0x80008fc0:anim_tempo_update=r[4]&1;anim_tempo=(uint16_t)wave_tempo(r[5]&0xffff);break; // CExScene: animations follow the chart tempo
  case 0x8000a6b4:r[3]=rd8(0x80320228);break; // CExScene::fn_8000A6B4 reads its static flag
  case 0x8000a6bc:wr32(0x80320230,0);break; // CExScene::fn_8000A6BC
  case 0x8000a6c8:wr32(0x80320230,rd32(0x80320230)+1);break; // CExScene::fn_8000A6C8
  case 0x80008160:case 0x8000818c:case 0x8000835c:case 0x80008830:break;
  case 0x80008a20:ex_scene_unload();break;
  case 0x8008d290:{uint32_t self=r[3];call(0x801dd6f4);wr32(self,0x802ed598);r[3]=self;break;} // CExFlow ctor
  case 0x8008d2cc:call(0x8008d290);break; // CExFlow::create (in place, the block is the flow)
  case 0x8fff001c:register_flow(r[4]);break; // gTickFlowManager->registerFlow<T>() from a scene's init
  case 0x8008d310:break;
  case 0x8008d368:exflow_command();break;
  // CTickFlowManager services used by the interpreter.
  case 0x801e4124:r[3]=++chart_instances;break;
  case 0x801e2928:f[1].d=(float)(frame_ticks*f[1].d);break;
  case 0x801e2b9c:if(song_ended){current_tempo=f[1].d;frame_ticks=current_tempo*.8f/60.0f;}break;
  case 0x801e26a8:break; // Tempo follows the backing track.
  // Speed (14): the chart and the backing track slow down or speed up together (the track's pitch with them).
  case 0x801e2c04:speed=f[1].d;wrf32(r[3]+0x60,speed);emit(14,fbits(speed),flow_rest());break;
  case 0x801e3938:music_sound=r[4];wr32(rd32(0x80320174)+0x1c,3);break; // prepareWave (the music is a wave sound)
  case 0x801e3960:music_sound=r[4];wr32(rd32(0x80320174)+0x1c,3); // playWave
  case 0x801e3a5c:if(grading)emit(21,music_sound,rd32(current_flow+0x1c));else if(!music_started){music_started=1;emit(6,music_sound,rd32(current_flow+0x1c));}break; // playPreparedWave: chart tick 0, overshot by -rest
  case 0x801e3e3c:r[3]=1;break; // wave prepared
  case 0x801e3c00:if(grading)emit(23,r[4],rd32(current_flow+0x1c));break;
  case 0x801e4134:tf_values[r[4]&15]=r[5]&0xffff;break; // rest-length slots (TF 0x0a)
  case 0x801e4144:r[3]=tf_values[r[4]&15];break;
  case 0x801e4154:sound_handle=r[4];break;
  case 0x801e415c:r[3]=sound_handle;break;
  case 0x801e7b30:r[3]=chart_handles+(r[4]&63)*8;break; // CSoundManager's numbered handles (TickFlow 0x2a)
  // Sequence/stream music, music stop and fades: the browser plays the one backing track.
  case 0x801e2ed8:case 0x801e2f00:case 0x801e300c:case 0x801e3120:case 0x801e334c:case 0x801e33c0:
  case 0x801e33c8:case 0x801e33f0:case 0x801e34ec:case 0x801e3690:case 0x801e38bc:break;
  case 0x801e3e2c:emit(13,r[4],fbits(f[1].d));break; // Backing track volume (13): fade frames, volume
  case 0x801e38cc:case 0x801e7334:r[3]=0;break; // stream playing / sound data loading
  case 0x801e6e08:case 0x801e6e4c:case 0x801e6ecc:case 0x801e7114:case 0x801e71c0:break; // player volumes
  // Input-check settings (forced inputs, offsets, input recording) and button cooldown: normal play.
  case 0x801e923c:case 0x801e9c30:case 0x801e9c38:case 0x801e9d7c:case 0x801e9d80:case 0x801e9d84:case 0x801d5500:break;
  case 0x8010a084:r[3]=0;break; // sprintf (only for input recording file names)
  // CBalloonLayout (message.brlyt): every scene places its speech balloon and the overlay strip
  // across the screen, and gives their text boxes to the message panes (CTickFlow::fn_801DEF58).
  case 0x8003a1d0:{ // fn_8003A1D0(pane, x, y, width, height, tail, tail x, tail y, flip tail)
    float v[]={f[1].d,f[2].d,f[3].d,f[4].d,f[5].d,f[6].d};uint32_t pane=r[4]&255;
    emit(15,(MESG_REGISTER<<8)|pane,0x10);emit(15,(MESG_TAIL<<8)|pane,(r[5]&255?1:0)|(r[6]&255?2:0));
    for(int i=0;i<6;i++)emit(15,((MESG_BOX_X+i)<<8)|pane,fbits(v[i]));
    break;
  }
  case 0x80039e00:emit(15,(MESG_REGISTER<<8)|(r[4]&255),r[5]?0x10:0x11);break;
  case 0x8003a418: // fn_8003A418(pane, y, height)
    emit(15,(MESG_REGISTER<<8)|(r[4]&255),0x12);
    emit(15,(MESG_OVERLAY_Y<<8)|(r[4]&255),fbits(f[1].d));emit(15,(MESG_OVERLAY_H<<8)|(r[4]&255),fbits(f[2].d));break;
  case 0x801e73d4:{uint32_t found=0;for(uint32_t i=0;i<162&&!found;i++)if(rd16(0x802e8210+i*8)==(r[4]&0xffff))found=0x802e8210+i*8;r[3]=found;break;} // CSoundManager::find_wave_info over the DOL's wave table
  // Layout transitions (frame decoration); not yet ported.
  case 0x8007263c:case 0x800726ac:case 0x8007271c:case 0x80072794:case 0x8007280c:break;
  // Archive/bank registration is completed by the static browser asset loader.
  case 0x801d3644:case 0x801d369c:case 0x801d3f94:case 0x801d41cc:case 0x801ed7d4:case 0x800db700:break;
  case 0x801db568:register_bank(r[4],r[6]&255);break; // CCellAnimManager::registBank(brcad, tpl, id)
  case 0x801dba98:break; // endBank frees the bank's data; the browser keeps every bank and the next registBank replaces the id.
  case 0x801dc068:{uint32_t bank=r[4]&255;for(uint32_t i=0;i<actor_count;i++)if(actor_active[i]&&rd8(actors[i]+12)==bank)end_actor_at(i);break;} // endCellAnimByBank
  case 0x801d422c:r[3]=1;break;
  case 0x801d4270:if(file_count>=512)panic(r[5],15);file_names[file_count]=r[5];r[3]=0x80410000+file_count++*32;break; // a file of a loaded archive, by name
  case 0x801d42e0:case 0x801d42fc:r[3]=1;break;
  case 0x801d5ff0:r[3]=0x80420000;break;
  case 0x801d6aec:break;
  case 0x801d6b2c:{ // CLayoutManager adds a layout and sets it up (_10)
    if(layout_count>=8)panic(layout_count,9);layout[layout_count++]=r[4];
    uint32_t setup=rd32(rd32(r[4])+0x10);
    if(setup==0x800399e4)emit(15,MESG_LAYOUT<<8,MESG_LAYOUT_BALLOON); // CBalloonLayout
    // Hole in One's CMyLayout gives its four messages to panes 0-3, hidden (fn_80072428).
    else if(setup==0x80072428){emit(15,MESG_LAYOUT<<8,MESG_LAYOUT_GOLF);for(uint32_t i=0;i<4;i++){emit(15,(MESG_REGISTER<<8)|i,0x20+i);emit(15,(MESG_VISIBLE<<8)|i,0);}}
    break;
  }
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
// A bank of one scene's archive, registered by name when the scene asks for it (registBank).
EMSCRIPTEN_KEEPALIVE uint32_t install_named_bank(uint32_t scene_index,uint32_t name,uint32_t count,uint32_t animations,uint32_t cells){
  if(named_bank_count>=64)panic(name,18);NamedBank*b=&named_banks[named_bank_count];
  b->scene=scene_index;b->count=count;b->animations=animations;b->cells=cells;
  uint32_t n=0;while(rd8(name+n)&&n<47){b->name[n]=rd8(name+n);n++;}b->name[n]=0;
  return named_bank_count++;
}
EMSCRIPTEN_KEEPALIVE void reset_runtime(void){
  combo_state=combo_frames=combo_down=combo_was_down=held_a=held_b=release_a=release_b=0;
  for(int i=0;i<256;i++)input_map[i]=i;
  memset(ram,0,sizeof(ram));memset(r,0,sizeof(r));memset(f,0,sizeof(f));memset(cr,0,sizeof(cr));memset(banks,0,sizeof(banks));
  memset(tf_values,0,sizeof(tf_values));tf_values[0]=32;tf_values[1]=16;tf_values[2]=16;tf_values[3]=8; // CTickFlowManager::_10's defaults
  sound_handle=envelope=0;speed=1;anim_tempo_update=anim_tempo=handle_count=0;
  chart_flow_count=chart_rerun=chart_instances=current_flow=music_started=song_ended=0;
  profile_index=next_profile=next_chart=fader_wait=flow_create_fn=persistent_count=named_bank_count=file_count=0;scene_state=SCENE_ACTIVE;fader_state=FADER_IDLE;grading=grading_scene=grading_ready=grading_pressed=grading_done=prompt_press=prompt_release=prompt_exit_remaining=message_table=message_count=0;prompt_exit_frames=5;music_sound=0xffffffff;frame_ticks=0;heap=0x80500000;call_depth=actor_count=checker_count=event_count=frame_number=layout_count=0;
  hits=misses=through=stray=perfect_failed=score_sum=score_count=wrong_count=0;wrong_timer=0;
  memset(canvas_timing,0,sizeof(canvas_timing));base_canvas=0;
  r[1]=0x81800000;r[2]=0x80328fe0;r[13]=0x80326ec0;
}
EMSCRIPTEN_KEEPALIVE void initialize_scene(void){
  // Instantiate only the service objects used by the minigame component.
  uint32_t globals[]={0x80320148,0x8032016c,0x80320170,0x80320174,0x80320178,0x80320180,0x80320184,0x80320188,0x8032018c,0x80320194};
  uint32_t vtable=alloc(256);for(int i=0;i<64;i++)wr32(vtable+i*4,0x8fff0000);
  for(int i=0;i<10;i++){uint32_t obj=alloc(4096);wr32(globals[i],obj);wr32(obj,vtable);}
  // gTickFlowManager's own table: _1C is registerFlow.
  uint32_t flow_vtable=alloc(256);memcpy(ram+idx(flow_vtable),ram+idx(vtable),256);wr32(flow_vtable+0x1c,0x8fff001c);wr32(rd32(0x80320174),flow_vtable);
  invoke1(0x801ead4c,rd32(0x8032016c));
  wrf32(rd32(0x80320174)+0x60,1.0f); // CTickFlowManager::mSpeed
  chart_handles=alloc(64*8);
  r[3]=2;call(profiles[profile_index].create);scene=r[3];wr32(rd32(0x80320180)+4,scene);
  for(int i=0;i<10;i++){
    canvas[i]=persistent[persistent_count++]=create_actor(255,0);
    if(i){r[3]=canvas[i];r[4]=canvas[i-1];r[5]=0;r[6]=0;call(0x801dcfa4);}
  }
  uint32_t you=persistent[persistent_count++]=create_actor(255,0);wr32(0x80320200,you);wr8(you+0xa7,0);
  uint32_t other=persistent[persistent_count++]=create_actor(255,0);wr32(0x803201f8,other);wr32(0x803201fc,other);
  invoke1(profiles[profile_index].init,scene);
  wr32(0x803201bc,7);wr8(0x803201b8,1);
  emit(4,scene,0);
}
EMSCRIPTEN_KEEPALIVE uint32_t scene_address(void){return scene;}
// The scene a remix's chart starts in (before initialize_scene).
EMSCRIPTEN_KEEPALIVE void select_scene(uint32_t index){if(index>=GAME_SCENE_COUNT)panic(index,19);profile_index=index;}
EMSCRIPTEN_KEEPALIVE uint32_t current_key(uint32_t actor){return key(actor);}
// The backing track's tempo at the current tick (the browser clock reads it from the chart's tempo table).
EMSCRIPTEN_KEEPALIVE void set_tempo(float tempo){current_tempo=tempo;}
EMSCRIPTEN_KEEPALIVE void set_delta(float ticks){delta_ticks=ticks;}
EMSCRIPTEN_KEEPALIVE void set_perfect_active(uint32_t enabled){wr8(0x803201b9,enabled);}
// Start the minigame's chart at its first command.
EMSCRIPTEN_KEEPALIVE void start_chart(uint32_t code){create_flow(code,0);}
EMSCRIPTEN_KEEPALIVE void install_messages(uint32_t table,uint32_t count){
  message_table=table;message_count=count;uint32_t cp=rd32(0x8032016c);
  wr32(cp+0x2e8,message(0));wr32(cp+0x2ec,message(101));wr32(cp+0x2f0,message(102));wr32(cp+0x2f4,message(103));wr32(cp+0x2f8,message(100));
}
EMSCRIPTEN_KEEPALIVE void calculate_grade(void){invoke1(0x801eb130,rd32(0x8032016c));}
EMSCRIPTEN_KEEPALIVE void start_grading(void){
  grading_ready=grading_pressed=0;
}
EMSCRIPTEN_KEEPALIVE void configure_grading_prompt(uint32_t frames){prompt_exit_frames=frames;}
EMSCRIPTEN_KEEPALIVE void grading_input(uint32_t down){
  if(!grading_ready)return;
  if(down&&!grading_pressed){grading_pressed=1;if((int32_t)prompt_press>=0)emit(1,prompt_press,0);}
  else if(!down&&grading_pressed==1){grading_pressed=2;grading_ready=0;if((int32_t)prompt_release>=0)emit(1,prompt_release,0);}
}
EMSCRIPTEN_KEEPALIVE uint32_t grading_state(void){return grading_ready|(grading<<2)|(grading_done<<4);}
EMSCRIPTEN_KEEPALIVE float grading_tempo(void){return current_tempo;}
EMSCRIPTEN_KEEPALIVE void grading_frame(void){delta_ticks=frame_ticks=current_tempo*.8f/60.0f;run_flows();if(prompt_exit_remaining)prompt_exit_remaining--;if(grading==2&&!chart_flow_count&&!grading_done){grading_done=1;emit(20,11,0);}if(grading)frame_number++;else finish_frame();}
EMSCRIPTEN_KEEPALIVE void set_frame_ticks(float ticks){frame_ticks=ticks;}
EMSCRIPTEN_KEEPALIVE uint32_t chart_state(void){return music_started|(song_ended<<1);}
EMSCRIPTEN_KEEPALIVE uint32_t chart_flow_count_value(void){return chart_flow_count;}
EMSCRIPTEN_KEEPALIVE uint32_t chart_flow_at(uint32_t i){return i<chart_flow_count?chart_flows[i]:0;}
// Once the chart has switched to grading, its flows wait for the results screen (grading_frame):
// a game that plays on to the end of its music would otherwise reach the result prompt early.
EMSCRIPTEN_KEEPALIVE void begin_frame(void){if(!grading)run_flows();}
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
// One input of the original's input types (EInputType): 4 A, 5 B, 6 A and B together.
// The hit and miss handlers get the input type (Screwbot Factory picks the claw's reaction from it).
static void press(uint32_t type){
  if(!rd8(rd32(0x80320170)+0x429))return; // CInputCheckManager::mAllowInput, set by the chart.
  uint32_t consumed=0;type=input_map[type&255]; // the chart's remap applies to every use below
  for(int i=(int)checker_count-1;i>=0;i--){
    uint32_t c=checkers[i];if(rd8(c+0x71))continue;
    r[3]=c;r[4]=type;call(0x801e7e28);if(!(r[3]&0xff))continue; // checker waits for this input type
    uint32_t quality=0x80400000;r[3]=c;r[4]=quality;r[5]=wrong_timer>0;f[1].d=0;
    call(rd32(rd32(c)+0x20));uint32_t judgment=r[3];
    if(judgment<=1){
      consumed=1;r[3]=c;r[4]=type;call(rd32(rd32(c)+(judgment==0?0x24:0x28)));
      if(r[3]){uint32_t grade=rd8(quality);score_sum+=grade;score_count++;wrong_count=0;r[3]=rd32(0x8032016c);r[4]=rd8(c+0x78);r[5]=judgment;call(0x801eaf2c);
        if(profiles[profile_index].end_on_hit&&rd8(c+0x70)){invoke1(rd32(rd32(c)+0x14),c);checker_count--;memmove(checkers+i,checkers+i+1,(checker_count-i)*4);}
      }
    }
  }
  if(!consumed){
    r[3]=type;call(profiles[profile_index].wrong_input);
    // CInputCheckManager::fn_801E94E8 and the stray count only follow A and A+B (unk430).
    if(type==4||type==6){stray++;wrong_timer=48;wrong_count=wrong_count<6?wrong_count+1:6;}
  }
}
// The buttons pressed (trig) and let go (release) this frame: bit 0 A, bit 1 B.
// CController::fn_801D4FD8 finds A and B pressed together (within 4 frames) and let go together;
// the input check in CInputCheckManager (InputCheckManager.cpp, top) then raises A+B (6) or its
// release (20) once, or holds a lone A or B (4, 5) or its release (18, 19) back 3 frames when a
// checker for the pair is within 12 ticks, in case the other button follows.
static uint32_t pair_near(uint32_t type){
  for(uint32_t i=0;i<checker_count;i++){
    r[3]=checkers[i];r[4]=input_map[type];call(0x801e7e5c);if(!(r[3]&0xff))continue;
    r[3]=checkers[i];f[1].d=-12;f[2].d=12;call(0x801e8018);if(r[3]&0xff)return 1;
  }
  return 0;
}
static void single(uint32_t *held,uint32_t pressed,uint32_t type,uint32_t pair,uint32_t wait_flag){
  if(*held){if(!--*held)press(type);return;}
  if(!pressed)return;
  if(rd8(rd32(0x80320170)+wait_flag)||pair_near(pair))*held=3;else press(type);
}
EMSCRIPTEN_KEEPALIVE void buttons(uint32_t trig,uint32_t release){
  combo_was_down=combo_down;
  if(!combo_was_down){
    if(combo_state==0){
      if((trig&3)==3){combo_state=3;combo_down=1;}
      else if(trig&1){combo_state=1;combo_frames=0;}
      else if(trig&2){combo_state=2;combo_frames=0;}
    }else if(combo_state==1||combo_state==2){
      if(++combo_frames>=4)combo_state=0;
      else if(trig&3){combo_state=3;combo_down=1;}
    }
  }else if(combo_state==3){
    if((release&3)==3){combo_state=0;combo_down=0;}
    else if(release&1){combo_state=2;combo_frames=0;}
    else if(release&2){combo_state=1;combo_frames=0;}
  }else if(combo_state==1||combo_state==2){
    if(++combo_frames>=4){combo_state=0;combo_was_down=combo_down=0;}
    else if(release&3){combo_state=0;combo_down=0;}
  }
  uint32_t pairs=rd8(rd32(0x80320170)+0x42e);
  if(combo_down&&!combo_was_down&&pairs){press(6);held_a=held_b=0;}
  else{single(&held_a,trig&1,4,6,0x498);single(&held_b,trig&2,5,6,0x499);}
  if(!combo_down&&combo_was_down&&pairs){press(20);release_a=release_b=0;}
  else{single(&release_a,release&1,18,20,0x49a);single(&release_b,release&2,19,20,0x49b);}
}
// The scene's update (_onCalc) and its cell animations (CCellAnimManager::_18 in CExScene::_18).
static void calc_scene(void){
  invoke1(profiles[profile_index].update,scene);
  for(uint32_t i=0;i<actor_count;i++)if(actor_active[i]){invoke1(0x801dc314,actors[i]);if(r[3])end_actor_at(i);}
}
static int is_persistent(uint32_t actor){for(uint32_t i=0;i<persistent_count;i++)if(persistent[i]==actor)return 1;return 0;}
// One frame of CGameManager::_1C's scene handling: a dead scene is replaced by the next (its memory
// group freed, so its cell animations go with it), then CScene::fn_801D83DC, then the fader.
static void scene_frame(void){
  if(scene_state==SCENE_DEAD){
    for(uint32_t i=0;i<actor_count;i++)if(actor_active[i]&&!is_persistent(actors[i]))end_actor_at(i);
    profile_index=next_profile;r[3]=2;call(profiles[profile_index].create);scene=r[3];wr32(rd32(0x80320180)+4,scene);
    scene_state=SCENE_INITIAL;emit(24,profile_index,0);
  }
  switch(scene_state){
  case SCENE_INITIAL:invoke1(rd32(rd32(scene)+0x10),scene);scene_state=SCENE_LOADING;break; // _10: load assets
  case SCENE_LOADING: // assets ready: _14 init, then one update (mUnk04), and the scene's chart starts
    invoke1(profiles[profile_index].init,scene);calc_scene();scene_state=SCENE_READY;
    if(next_chart){create_flow(next_chart,0);next_chart=0;}
    break;
  case SCENE_READY:if(fader_state==FADER_IDLE)scene_state=SCENE_ACTIVE;break;
  case SCENE_ACTIVE:calc_scene();break;
  case SCENE_SCHEDULE_DOWN:if(fader_state==FADER_WAIT1)scene_state=SCENE_DOWN;break;
  case SCENE_DOWN:invoke1(rd32(rd32(scene)+0x20),scene);scene_state=SCENE_DEAD;break; // _20: unload
  }
  if(fader_state==FADER_WAIT1){if(fader_wait)fader_wait--;else{fader_state=FADER_WAIT2;fader_wait=2;}}
  else if(fader_state==FADER_WAIT2&&!--fader_wait)fader_state=FADER_IDLE;
}
// CScene::fn_801D8554: only these states draw; CFaderFlash::_0C covers the screen while it waits.
static int scene_drawn(void){return scene_state==SCENE_READY||scene_state==SCENE_ACTIVE||scene_state==SCENE_SCHEDULE_DOWN;}
EMSCRIPTEN_KEEPALIVE uint32_t screen_state(void){return scene_drawn()|((fader_state!=FADER_IDLE)<<1);}
EMSCRIPTEN_KEEPALIVE void finish_frame(void){
  invoke1(0x801eae20,rd32(0x8032016c));
  for(int i=(int)checker_count-1;i>=0;i--){
    uint32_t c=checkers[i];invoke1(rd32(rd32(c)+0x18),c);
    if(r[3]){invoke1(rd32(rd32(c)+0x14),c);checker_count--;memmove(checkers+i,checkers+i+1,(checker_count-i)*4);}
  }
  if(wrong_timer>0){wrong_timer-=delta_ticks;if(wrong_timer<0)wrong_timer=0;}
  for(int i=0;i<10;i++)for(int a=0;a<2;a++){uint32_t t=canvas_timing[i][a];if(t&&rd8(t+37)){r[3]=t;r[4]=0;call(0x801e9de8);wrf32(canvas[i]+0x8c+a*4,rdf32(t+40));}}
  scene_frame();
  // The scene's draw hook (vtable +0x1C), which sets what is visible before drawing; the drawing
  // itself (CExScene::_1C) is the browser renderer's job.
  if(scene_drawn()){invoke1(rd32(rd32(scene)+0x1c),scene);profiles[profile_index].after_update();}
  frame_number++;
}
EMSCRIPTEN_KEEPALIVE uint32_t checker_at(uint32_t i){return i<checker_count?checkers[i]:0;}
EMSCRIPTEN_KEEPALIVE uint32_t stat(uint32_t id){switch(id){case 0:return hits;case 1:return misses;case 2:return through;case 3:return stray;case 4:return perfect_failed;case 5:return frame_number;case 6:return checker_count;case 7:return score_sum;case 8:return score_count;}return 0;}
EMSCRIPTEN_KEEPALIVE uint32_t invoke_original(uint32_t address,uint32_t a,uint32_t b,uint32_t c,uint32_t d,float f1,float f2,float f3){r[3]=a;r[4]=b;r[5]=c;r[6]=d;f[1].d=f1;f[2].d=f2;f[3].d=f3;call(address);return r[3];}
