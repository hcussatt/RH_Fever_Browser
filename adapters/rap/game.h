// Love Rap (Game/Rap) profile for the Wii platform backend.
#define GAME_SCENE_CREATE 0x8005029c  // scene constructor
#define GAME_SCENE_INIT 0x80050574    // scene _onInit
#define GAME_SCENE_UPDATE 0x80050ce0  // scene _onCalc
#define GAME_FLOW_COMMAND 0x8004f850  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x80050284   // reaction to a press with no cue
#define GAME_FLOW_CREATE 0x8004f7a8   // MyFlow::create(chart, rest)
#define GAME_END_CHECKER_ON_HIT 0
#define GAME_CALLS \
  /* Lyric captions (Rap::CMyLayout): message layouts are not ported yet. */ \
  case 0x80072e94:case 0x80072f74:case 0x80072ff8:case 0x8007307c:case 0x80073100:case 0x8007314c:case 0x80073198:break;
#define GAME_AFTER_UPDATE
