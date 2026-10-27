// The navigator (Game/Navi) profile for the Wii platform backend: Remix 10 changes to it for a few beats.
#define GAME_SCENE_CREATE 0x8009b39c  // scene constructor
#define GAME_SCENE_INIT 0x8009b5e8  // scene _onInit
#define GAME_SCENE_UPDATE 0x8009bef8  // scene _onCalc
#define GAME_FLOW_COMMAND 0x8009acf8  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x8009b338  // reaction to a press with no cue
#define GAME_FLOW_CREATE 0x8009ac50  // MyFlow::create(chart, rest)
#define GAME_CALLS
#define GAME_AFTER_UPDATE
