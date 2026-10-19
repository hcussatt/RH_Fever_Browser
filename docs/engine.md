# The shared engine

Every minigame runs on one engine. A game contributes only a manifest and a
short C profile; everything else it needs is read from the user's ISO at build
time.

## Layers

| Layer | Where | Knows about |
| --- | --- | --- |
| Shell | `web/engine/main.mjs`, `clock.mjs`, `input.mjs`, `index.html` | The page, the audio clock, player input, pause, the end-of-song result. Nothing console-specific. |
| Wii backend | `web/engine/runtime.mjs`, `renderer.mjs`, `layout.mjs`, `audio.mjs`, `adapters/wii/platform.c` | Translated PowerPC code in WASM, cell animations, NW4R layouts, NW4R sound programs. |
| Game | `games/<id>/game.json`, `adapters/<id>/game.h` | One minigame's original addresses, banks, sounds and timing options. |

Built output: `dist/engine/` holds the shared code once; `dist/<id>/` holds the
game's page, manifest, WASM and extracted assets. `dist/games.json` lists the
built games for the picker page.

## Timing model

- `clock.mjs` maps chart ticks (48 per beat) to seconds of the backing track,
  either at a fixed rate or through the chart's tempo segments.
- Some games change the song's speed mid-chart (Sneaky Spirits slows to a
  quarter on each hit). `createTrack()` maps wall time to backing-track
  position through those speed changes; the chart's tick is always taken from
  the track position, so the game and the music stay in step.
- The frame loop advances the original code one 60 Hz frame at a time up to the
  frame of the audio the player is hearing (`heardTime()`), so audio drives the
  game, not the other way round.
- `input.mjs` turns each press and release of A or B into `{player, frame, at,
  button, down}` in a queue. The simulation reads only that queue. Original
  timing windows and Perfect rules are untouched: no widened windows, score
  forcing or rollback.
- Keys: A is Space, Left Shift, X, left click or gamepad A; B is Right Shift,
  right click or gamepad B. Mouse buttons are read from the held-button mask on
  every pointer event, since a second button pressed or let go while another is
  held raises only a pointermove.
- Each input is stamped with its own event time and belongs to the first frame
  after the audio heard then. That frame runs as soon as its time is heard (a
  timer), not at the next screen refresh, so hit sounds are not held back.
- Each frame the backend (`buttons()` in `adapters/wii/platform.c`) turns the
  buttons into the original input types like the original controller and
  input check: A (4), B (5), A and B pressed together (6) and their releases
  (18, 19, 20). A lone A or B is held back 3 frames when an A+B checker is
  within 12 ticks, as in the original. A checker only answers the input types
  it lists; a chart can remap one type to another.
- A hit can re-arm a checker for a later beat with another input (Screwbot
  Factory: press A+B, let go two beats later), so cues are re-read whenever a
  checker's target moves, and the timeline keeps each cue's input
  (`cueInputs`).
- A checker listing input type -1 takes no press and hits itself on its beat
  (See-Saw's partner, who plays itself in one-player mode), so it is not a cue.

## Charts

The original chart bytecode (TickFlow) runs live in the original interpreter
(`CTickFlow`, translated like the game code). `platform.c` stands in for the
flow manager: it keeps the list of running flows and steps them each frame the
way the original `CTickFlowManager` does (newest first, again in the same frame
when a flow starts another), and supplies the sound, tempo and input services
the interpreter calls.

- `tools/chart-index.py` finds the game's main chart from the executable: the
  scene change to the manifest's `scene` whose chart starts grading (ExFlow
  `0x118`), its music (`PREPARE_WAVE`), that music's tempo table, and the sound
  groups the loading charts load before preparing the scene. It writes
  `assets/original-chart.json`. `tools/extract-assets.py` keeps the group loads
  that include the music and extracts every sound stored in those groups, plus
  the system group (group 0: `SE_MISS` and the other sounds every game shares).
  `tools/extract-sfx.py` merges every bank and sequence in them; each sound plays
  with the bank its record names.
- At load the chart runs silently from its first command to the music start,
  which is chart tick 0. From then on the browser clock drives it.
- `tools/chart-timeline.mjs` does one silent run of the whole level at build
  time and writes `assets/original-timeline.json`: the chart's own sounds with
  their exact ticks (scheduled ahead on the audio thread so they never depend
  on frame timing), the game commands with their ticks, each input checker's
  perfect tick (`cues`, from the checker's own pass and just ticks; used by the
  autoplay tests) and the tick where grading starts (the end of the song).
- Every event the chart emits during play carries the issuing flow's remaining
  rest, so its exact tick is the frame's end tick plus that rest.
- Flows that only start during play (the response to a hit or a miss) are not in
  the timeline. Their chart sounds play live: `runtime.mjs` schedules ahead only
  the sounds it can match to the timeline.

## Remixes

A remix manifest (`games/remix1/game.json`) names its music and the scenes it
changes between (`wii.scenes`: each scene's game and the remix version of its
graphics) instead of one scene. The build compiles every scene's game into one
core: `tools/recompile.py` writes `build/<id>/scenes.h` with each game's
`game.h` renamed per scene and a profile table, and `platform.c` keeps the
current profile.

- `tools/chart-index.py` finds the remix chart from its music: the scene change
  (`0x100` with no chart) just before `PREPARE_WAVE` starts it, the scene load
  before that gives the first scene and its version, and the group loads (`0x12c`)
  of the entry chart and the charts it starts alongside itself give the sounds.
- A scene change during play follows `CGameManager`/`CScene`: the scene is
  scheduled down, the fader (`CFaderFlash`) covers the screen, the old scene's
  `_20` ends its banks and animations (`endCellAnimByBank`, `CExScene::_20`),
  and the next scene is created, loaded, initialised and drawn once the fader
  is idle (about seven black frames, as in the original). The chart waits with
  `0x104` and takes the wait off its rest (`0x130`) so it keeps to the music.
- Every bank of every scene archive is installed at load under its file name.
  A scene's `registBank` picks one by the name of the file it read, so a scene
  version that registers different banks needs no manifest list (event 25 tells
  the renderer which bank an id now draws).
- `tools/extract-assets.py` numbers textures across the scenes
  (`<game>-texture-<n>.png`) and keys banks `<game>/<name>`.

## Layouts

Some games draw 2D layouts (NW4R lyt) over the cell animations, like Love Rap's
lyric captions. `tools/extract-layout.py` converts the layout named in the
manifest's `wii.layout` (panes, materials, BRLAN animations, textures), the
glyphs its font needs and the game's message text (`riq_E.bmg`).
`web/engine/layout.mjs` draws it: pictures and text tinted by their material's
two colour registers, animations stepped once per game frame like
`CLayoutAnimation`, and wide-screen location adjustment like `CLayoutManager`.
A material with its own TEV stages (the Superb stamp's stars) is combined per
texel like GX, with its texture SRT and colour register animations (RLTS,
RLMC). Each glyph is cut from the font sheet with a clear border, so scaled
text does not pick up its neighbours' edges.
The game's layout class is replaced in `adapters/<id>/game.h` by layout events
(kind 11: play or stop an animation, set a text box's message, offset a pane),
indexing the manifest's `animations`, `texts` and `panes` lists.

### Message panes

Charts also show text in message panes: TickFlow `0x40` shows or hides pane *n*,
`0x41` gives it a string and ExFlow `0x124` a message by id (`riq_E.bmg`). A pane
is a text box some layout handed to the chart (`CTickFlow::fn_801DEF58`): the
shared speech balloon (`CBalloonLayout`, `message.brlyt` in `layout_common.szs`),
which each scene places and sizes, or a game's own (Hole in One's `CMyLayout`,
named by the manifest's `wii.messageLayout`). Remix 1's opening lines use Hole in
One's; Tap Trial's giraffe uses the balloon. `platform.c` reports the layouts the
scene adds, the panes they register, the balloon's placement and the chart's
commands as message events (kind 15); `web/engine/message.mjs` draws them with
`layout.mjs`. Hole in One's layout also holds its screen frame (`W_frm_00`): the
game plays its two animations (`baseball_frm_change_00/01`, forward, reversed or
straight to the end) as it changes view, and the same events drive them. `tools/extract-layout.py` writes `message-layouts.json` for every
game.

## Audio

`web/engine/audio.mjs` plays the original samples with Web Audio, following the
original nw4r sound code where it matters for how a game sounds:

- Note envelopes (attack, hold, decay, sustain, release) come from the original
  `EnvGenerator`, translated with the game code and stepped every 3 ms like
  `Channel::Update` (`envelope()` in `runtime.mjs`). Curves are cached per shape.
- Volume follows the original rules: the sound record's volume and the
  instrument's volume are linear, velocity and track volumes squared. The
  backing track plays at its own record volume through the same output, so
  music and sounds keep the original balance. The output is the game's master
  volume (0.7) times a fixed browser headroom.
- Volume, pitch and pan the chart sets on a sound (TickFlow sound tuning, event
  kind 10) ride along with that sound, in the live events and in the timeline.
- Sound handles: a sound played on a handle (the game's `SNDHandle`) can be
  tuned, faded, paused or stopped later through that handle, like Sneaky
  Spirits' looping rain. Tunes with a fade length fade over that many game
  frames (1/60 s). A negative start delays a sound by that many ticks; a
  positive one starts it that far into the sequence.
- Speed changes (event kind 14) change the backing track's rate and every
  sound not yet started is rescheduled; music volume (kind 13) fades the
  backing track.
- Sounds are scheduled 0.3 s ahead. Sounds the game plays from chart commands
  (kind 12) are pre-scheduled when five extra dry runs (on time, early, late,
  stray presses, every other cue) agree on them; the rest play live.
- Sounds played before the chart starts (scene setup and pre-roll) are kept.
- Event kinds: 1 game sound, 3 perfect failed, 5 chart sound, 7 end, 8 chart
  command, 10 tune, 11 layout, 12 game sound from a chart command, 13 music
  volume, 14 speed, 15 message pane. Each event is 5 words: kind, value, extra, frame, handle.
- Pitch interpolation, LFO and filters are approximated.

`web/engine/qa/audio-check.mjs` renders a whole autoplay run offline and reports
peak, clipping and RMS.

## Results and versus mode

The page exposes its original result in `window.rhf.result` and emits `rhf-result`.
`main.mjs` accepts a future monotonic deadline in `start(at)`; solo play still starts
shortly ahead. The multiplayer path maps the deadline to the local heard-audio
clock. No remote inputs, frame waits, timing changes, or scoring corrections occur.

`multiplayer.mjs` mounts the persistent host-controlled lobby in the main Pages arcade.
It owns the connection while same-origin game iframes expose prepare/start/stop APIs.
`peer-match.mjs` owns WebRTC, compatibility, clock estimates, rounds and summaries.
See [multiplayer.md](multiplayer.md) for use, protocol, limits and validation.

## Adding a game

1. `games/<id>/game.json`: copy an existing one. `wii.units` are the decomp
   translation units to translate (see `third_party/rhf-decomp/config/SOME01/splits.txt`);
   `banks` are the cell-animation banks the scene can register (found by file name);
   `scene` names the
   decomp's scene (`sceneVariant` picks one main chart when the scene has
   several, and is the scene version the game sets before loading it: Double
   Date's version 1 is the sunset bench with both couples); `input` is the input the game's cues wait for (4 A, the default,
   or 6 A and B together; the page shows controls from the cues' own inputs);
   `perfectActive`, `projection` and `endsWithMusic`
   cover how the game plays and ends.
2. `adapters/<id>/game.h`: the scene constructor, init, update, flow command and
   wrong-input addresses and the flow constructor, plus any extra platform calls the game makes
   (`GAME_CALLS`) and per-frame hooks (`GAME_AFTER_UPDATE`). The build fails with
   the address of any call that is still missing.
3. `./build.sh <iso>` builds and tests every game that has a manifest.
4. Add the game to its remix set in `web/engine/menu.mjs` (the first remix whose
   graphics it has on the disc, `cellanim/<game>/remix0N`); games in no remix are
   listed under Other games.

## Other consoles (later)

A game from the GBA, DS or 3DS entries would get its own backend next to `wii`
(ROM reader, CPU translator, platform layer, asset and audio converters) and a
manifest naming that platform. The shell stays as it is.
