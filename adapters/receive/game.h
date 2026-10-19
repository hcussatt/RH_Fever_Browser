// Bossa Nova (Game/Receive) profile for the Wii platform backend.
#define GAME_SCENE_CREATE 0x800535d4  // scene constructor
#define GAME_SCENE_INIT 0x80053b0c  // scene _onInit
#define GAME_SCENE_UPDATE 0x80054dd4  // scene _onCalc
#define GAME_FLOW_COMMAND 0x80053148  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x800535c0  // reaction to a press with no cue
#define GAME_FLOW_CREATE 0x800530a0  // MyFlow::create(chart, rest)
// Subtitles (Receive's CMyLayout, subtitles.brlyt; its setup is 0x800BB294) become layout events
// (11) for web/engine/layout.mjs. Text box 0 is T_subtitles_00 in games/receive/game.json. The
// endless mode's per-character panes (fn_800BB7FC, fn_800BBC0C) are not ported.
#define GAME_CALLS \
  case 0x800bb77c: /* show message r4 (a message id string), or hide the subtitle when r4 is 0 */ \
    if(rd32(rd32(r[3])+0x10)!=0x800bb294)panic(r[3],20); \
    if(r[4]){emit(11,0x300,bmg_id(r[4]));emit(11,0x700,1);}else emit(11,0x700,0); \
    break;
#define GAME_AFTER_UPDATE
