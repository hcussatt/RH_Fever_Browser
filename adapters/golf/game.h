// Hole in One (Game/Baseball) profile for the Wii platform backend.
#define GAME_DEFAULT_TEMPO 115.0f
#define GAME_SCENE_CREATE 0x800657b4  // scene constructor
#define GAME_SCENE_INIT 0x80065b2c    // scene _onInit
#define GAME_SCENE_UPDATE 0x80066338  // scene _onCalc
#define GAME_FLOW_COMMAND 0x80065134  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x80065768   // reaction to a press with no cue
#define GAME_AUX_SCRIPTS 0            // aux scripts run one command
#define GAME_END_CHECKER_ON_HIT 0
#define GAME_CHART_TEMPO 0            // fixed tempo; no set_tempo export
#define GAME_CALLS
// The original draw callback updates the monkey face visibility.
#define GAME_AFTER_UPDATE \
  uint32_t monkey=rd32(scene+0x3c),anim=rd16(monkey+14); \
  wr8(rd32(scene+0x40)+0xa7,anim<=1||anim==3);
