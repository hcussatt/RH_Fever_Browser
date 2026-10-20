// Sneaky Spirits (Game/AgbGhost) profile for the Wii platform backend.
#define GAME_SCENE_CREATE 0x800a76a4  // scene constructor
#define GAME_SCENE_INIT 0x800a77e8    // scene _onInit
#define GAME_SCENE_UPDATE 0x800a7c8c  // scene _onCalc
#define GAME_FLOW_COMMAND 0x800a72b0  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x800a75dc   // reaction to a press with no cue
#define GAME_FLOW_CREATE 0x800a7208   // MyFlow::create(chart, rest)
#define GAME_CALLS \
  case 0x80124550:r[3]=1;break; /* Widescreen presentation. */
#define GAME_AFTER_UPDATE
