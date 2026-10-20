// Figure Fighter (Game/Muscle) profile for the Wii platform backend.
#define GAME_SCENE_CREATE 0x80034354  // scene constructor
#define GAME_SCENE_INIT 0x800346b0  // scene _onInit
#define GAME_SCENE_UPDATE 0x80034db4  // scene _onCalc
#define GAME_FLOW_COMMAND 0x80033da4  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x80034340  // reaction to a press with no cue
#define GAME_FLOW_CREATE 0x80033cfc  // MyFlow::create(chart, rest)
// Messages (Muscle::CMyLayout, muscle.brlyt; its setup is 0x80077588, which the platform does not
// run) become layout events (11) for web/engine/layout.mjs: text box 0 is T_message_00 and
// 1 is its pane N_message_00, hidden at setup and placed at (40, 80), x times 0.75 on a wide
// screen (SCGetAspectRatio 1, the port's 854x480 projection).
#define GAME_CALLS \
  case 0x800776dc: /* show message r4 (a message id string) */ \
    if(rd32(rd32(r[3])+0x10)!=0x80077588)panic(r[3],20); \
    {union{float v;uint32_t u;}x={.v=40.0f*0.75f},y={.v=80.0f};emit(11,0x400,x.u);emit(11,0x500,y.u);} \
    emit(11,0x300,bmg_id(r[4]));emit(11,0x701,1);break; \
  case 0x80077744:emit(11,0x701,0);break; /* hide it */
#define GAME_AFTER_UPDATE
