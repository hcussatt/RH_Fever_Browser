// Flipper-Flop (Game/Goma) profile for the Wii platform backend.
#define GAME_SCENE_CREATE 0x8004ddc4  // scene constructor
#define GAME_SCENE_INIT 0x8004df68  // scene _onInit
#define GAME_SCENE_UPDATE 0x8004e9d4  // scene _onCalc
#define GAME_FLOW_COMMAND 0x8004d61c  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x8004ddb0  // reaction to a press with no cue
#define GAME_FLOW_CREATE 0x8004d574  // MyFlow::create(chart, rest)
#define GAME_CALLS
#define GAME_AFTER_UPDATE
