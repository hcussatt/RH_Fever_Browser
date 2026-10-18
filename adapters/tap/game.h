// Tap Trial (Game/AgbTap) profile for the Wii platform backend.
#define GAME_DEFAULT_TEMPO 126.0f
#define GAME_SCENE_CREATE 0x800a8fb8  // scene constructor
#define GAME_SCENE_INIT 0x800a90f0    // scene _onInit
#define GAME_SCENE_UPDATE 0x800a9504  // scene _onCalc
#define GAME_FLOW_COMMAND 0x800a8df8  // MyFlow chart command dispatcher
#define GAME_WRONG_INPUT 0x800a8fa4   // reaction to a press with no cue
#define GAME_AUX_SCRIPTS 1            // aux scripts run until a wait
#define GAME_END_CHECKER_ON_HIT 1     // checkers flagged at +0x70 end on a hit
#define GAME_CHART_TEMPO 1            // tempo follows the chart's segments
#define GAME_CALLS \
  case 0x801d5500:break; /* Browser adapter supplies the original A-trigger channel. */ \
  case 0x80039e00:case 0x8003a1d0:break; /* Balloon text placement is presentation-only. */ \
  case 0x80124550:r[3]=1;break; /* Widescreen presentation. */
#define GAME_AFTER_UPDATE
