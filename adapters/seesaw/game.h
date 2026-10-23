// See-Saw (Game/Seesaw) profile for the Wii platform backend.
#define GAME_SCENE_CREATE 0x8002cf84  // scene constructor
#define GAME_SCENE_INIT 0x8002d258    // scene _onInit
#define GAME_SCENE_UPDATE 0x8002d7a0  // scene _onCalc
#define GAME_FLOW_COMMAND 0x8002f4c8  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x8002cf80   // reaction to a press with no cue: none (an empty function)
#define GAME_FLOW_CREATE 0x8002f420   // MyFlow::create(chart, rest)
// The wrong-input handler is a lone blr that the split places in the Rocket unit, so it
// is not translated with See-Saw.
#define GAME_CALLS \
  case 0x8002cf80:break;
#define GAME_AFTER_UPDATE
