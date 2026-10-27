// Night Walk (Game/NightWalk) profile for the Wii platform backend.
#define GAME_SCENE_CREATE 0x800ab9c8  // scene constructor
#define GAME_SCENE_INIT 0x800abd58  // scene _onInit
#define GAME_SCENE_UPDATE 0x800ac358  // scene _onCalc
#define GAME_FLOW_COMMAND 0x800ab294  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x800ab910  // reaction to a press with no cue
#define GAME_FLOW_CREATE 0x800ab1ec  // MyFlow::create(chart, rest)
#define GAME_LYRIC_LAYOUT 1  // its song title card is in the lyric layout (lyricLayout), not the sky
// The night sky (NightWalk::CMyLayout, nightWalkBg.brlyt) becomes layout events (11) for
// web/engine/layout.mjs; its code is not translated. Animations and panes index the "layout" lists
// in games/nightwalk/game.json, in the order its setup (fn_800C52E4) binds them: 0 the demo on
// N_bgScroll_00 (the scrolling hills), 1 on N_starAll_00 (not recursive), 2 on P_flash_00, 3-6 on
// N_birdsAll_00-03; then each star's wait (7+i) and flash (208+i). Panes: star i is i, N_birdsAll_01-03
// are 201-203. Action op<<16|index carries the larger indices.
// The 201 stars sit at random places (CRandom lbl_803D5D20) in N_starAll_00, which the demo moves
// left 1000 over its first 4690 frames (a straight line in nightWalkBg_demo.brlan); a star that
// scrolls off the left goes back in on the right, and a hit flashes a random star in view.
#define NW_STARS 201
#define NW_RANDOM 0x803d5d20
#define NW_ACTION(op,i) emit(11,(op)<<16|(i),0)
#define NW_PLAY(i) NW_ACTION(1,i) /* CLayoutAnimation::playFromBeginForward */
#define NW_STOP(i) NW_ACTION(2,i) /* mIsPlaying = false */
#define NW_TUTORIAL() (rd32(0x80326ec0-27048)==0) /* lbl_80320188: the tutorial sky (nightWalkBgTuto.brlyt) */
static float nw_x[NW_STARS];
static uint8_t nw_ready[NW_STARS],nw_demo_playing,nw_demo_skip;
static uint32_t nw_demo_frame;
// N_starAll_00's x at the demo frame last applied.
#define NW_SCROLL() (nw_demo_frame>=4690?-1000.0f:-1000.0f*(float)nw_demo_frame/4690.0f)
#define NW_RANDOM_FLOAT(range) (r[3]=NW_RANDOM,f[1].d=(range),call(0x801da964),(float)f[1].d)
// A star put at (x, random y) restarts its wait animation, has its flash turned off and can flash.
#define NW_PLACE(i,x) do{ \
  union{float v;uint32_t u;}px={.v=(x)},py={.v=-200.0f+NW_RANDOM_FLOAT(400.0)}; \
  nw_x[i]=px.v;emit(11,10<<16|(i),px.u);emit(11,11<<16|(i),py.u); \
  NW_PLAY(7+(i));NW_ACTION(9,208+(i));nw_ready[i]=1; \
}while(0)
#define GAME_CALLS \
  /* The credits layout's fn_800C50CC: its four lines' materials get colour registers 0 (0,0,0,0) and \
     1 (0,0,0,255), so the white text turns black (by day, over the light sky). */ \
  case 0x800c50cc:emit(15,MESG_CREDIT_DARK<<8,0);break; \
  case 0x800c5288:wr32(r[3],0x802f0908);break; /* CMyLayout ctor (vtable lbl_802F0908) */ \
  case 0x800c52e4:{ /* setup */ \
    if(NW_TUTORIAL())panic(r[3],23); \
    nw_demo_playing=nw_demo_skip=0;nw_demo_frame=0; \
    for(uint32_t i=0;i<NW_STARS;i++){float x=-500.0f+NW_RANDOM_FLOAT(1100.0);NW_PLACE(i,x);} \
    break;} \
  case 0x800c59cc: /* play the demo: hills, stars, flash and birds */ \
    for(uint32_t i=0;i<7;i++)NW_PLAY(i); \
    nw_demo_playing=nw_demo_skip=1;nw_demo_frame=0;break; \
  case 0x800c5b0c: /* stop it (the hills, stars, flash and three bird flocks) and hide those flocks */ \
    NW_STOP(0);NW_STOP(1);NW_STOP(2);NW_STOP(4);NW_STOP(5);NW_STOP(6);nw_demo_playing=0; \
    for(uint32_t i=0;i<3;i++)emit(11,12<<16|(NW_STARS+i),0); \
    break; \
  case 0x800c5c08:{ /* a hit flashes a random star in view (-300 < x < 300) that has not flashed */ \
    float scroll=NW_SCROLL(); \
    for(uint32_t n=0;n<NW_STARS;n++){ \
      r[3]=NW_RANDOM;r[4]=NW_STARS;call(0x801da908);uint32_t k=r[3];float x=scroll+nw_x[k]; \
      if(nw_ready[k]&&x>-300.0f&&x<300.0f){NW_PLAY(208+k);nw_ready[k]=0;break;} \
    } \
    break;}
// CMyLayout::_18 (fn_800C582C) each frame: stars scrolled past -500 go back in at 450-600, then
// the layout's animations advance (the browser draws them; the demo's frame is followed here).
#define GAME_AFTER_UPDATE { \
  float scroll=NW_SCROLL(); \
  for(uint32_t i=0;i<NW_STARS;i++)if(scroll+nw_x[i]<-500.0f){float x=450.0f+NW_RANDOM_FLOAT(150.0);NW_PLACE(i,x-scroll);} \
  if(nw_demo_playing){if(nw_demo_skip)nw_demo_skip=0;else if(++nw_demo_frame>=6480){nw_demo_frame=6480;nw_demo_playing=0;}} \
}
