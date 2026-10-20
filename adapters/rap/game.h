// Love Rap (Game/Rap) profile for the Wii platform backend.
#define GAME_SCENE_CREATE 0x8005029c  // scene constructor
#define GAME_SCENE_INIT 0x80050574    // scene _onInit
#define GAME_SCENE_UPDATE 0x80050ce0  // scene _onCalc
#define GAME_FLOW_COMMAND 0x8004f850  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x80050284   // reaction to a press with no cue
#define GAME_FLOW_CREATE 0x8004f7a8   // MyFlow::create(chart, rest)
// Lyric captions (Rap::CMyLayout, src/Game/Rap/MyLayout.cpp) become layout events (11) for the
// browser's layout renderer (web/engine/layout.mjs). The animation, text box and pane numbers
// index the "layout" lists in games/rap/game.json, in the order CMyLayout::_10 sets them up.
#define MESSAGE_ID(s) bmg_id(s)
#define LAYOUT_PLAY(a) emit(11,0x100|(a),0)
#define LAYOUT_STOP(a) emit(11,0x200|(a),0)
#define LAYOUT_TEXT(t,s) emit(11,0x300|(t),MESSAGE_ID(s))
static uint8_t rap_message00_shown; // CMyLayout::mUnk48: message 00 (not the miss message) is up
#define GAME_CALLS \
  case 0x80072e94: /* show message 00, or the miss message */ \
    if(r[5]&0xff){LAYOUT_TEXT(1,r[4]);LAYOUT_STOP(5);LAYOUT_PLAY(1);rap_message00_shown=0;} \
    else{LAYOUT_TEXT(0,r[4]);LAYOUT_STOP(4);LAYOUT_PLAY(0);rap_message00_shown=1;} \
    break; \
  case 0x80072f74:LAYOUT_TEXT(2,r[4]);LAYOUT_STOP(6);LAYOUT_PLAY(2);break; /* message 01 */ \
  case 0x80072ff8:LAYOUT_TEXT(3,r[4]);LAYOUT_STOP(7);LAYOUT_PLAY(3);break; /* message 02 */ \
  case 0x8007307c: /* hide whichever of message 00 and the miss message is up */ \
    if(rap_message00_shown){LAYOUT_STOP(0);LAYOUT_PLAY(4);}else{LAYOUT_STOP(1);LAYOUT_PLAY(5);} \
    break; \
  case 0x80073100:LAYOUT_STOP(2);LAYOUT_PLAY(6);break; \
  case 0x8007314c:LAYOUT_STOP(3);LAYOUT_PLAY(7);break; \
  case 0x80073198:{ /* message 02 follows the car: its layout position plus (x, -y) */ \
    union{float v;uint32_t u;}x={.v=f[1].d},y={.v=-f[2].d};emit(11,0x400,x.u);emit(11,0x500,y.u);break;}
#define GAME_AFTER_UPDATE
