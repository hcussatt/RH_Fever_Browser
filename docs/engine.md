# The shared engine

Every minigame runs on one engine. A game contributes only a manifest and a
short C profile; everything else it needs is read from the user's ISO at build
time.

## Layers

| Layer | Where | Knows about |
| --- | --- | --- |
| Shell | `web/engine/main.mjs`, `clock.mjs`, `input.mjs`, `index.html` | The page, the audio clock, player input, pause, the end-of-song result. Nothing console-specific. |
| Wii backend | `web/engine/runtime.mjs`, `renderer.mjs`, `audio.mjs`, `adapters/wii/platform.c` | Translated PowerPC code in WASM, cell animations, NW4R sound programs. |
| Game | `games/<id>/game.json`, `adapters/<id>/game.h` | One minigame's original addresses, banks, sounds and timing options. |

Built output: `dist/engine/` holds the shared code once; `dist/<id>/` holds the
game's page, manifest, WASM and extracted assets. `dist/games.json` lists the
built games for the picker page.

## Timing model

- `clock.mjs` maps chart ticks (48 per beat) to seconds of the backing track,
  either at a fixed rate or through the chart's tempo segments.
- The frame loop advances the original code one 60 Hz frame at a time up to the
  frame of the audio the player is hearing (`heardTime()`), so audio drives the
  game, not the other way round.
- `input.mjs` turns each press into `{player, frame, at}` in a queue. The
  simulation reads only that queue. Original timing windows and Perfect rules
  are untouched: no widened windows, score forcing or rollback.

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
  that include the music and extracts every sound stored in those groups.
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
- Pitch interpolation, LFO and filters are approximated.

`web/engine/qa/audio-check.mjs` renders a whole autoplay run offline and reports
peak, clipping and RMS.

## Results and versus mode (planned)

When the song ends the page sets `window.rhf.result` to
`{hits, misses, through, stray, perfectFailed}` and fires an `rhf-result` event.
Starting the song is one function, `start()` in `main.mjs`.

The planned versus mode keeps every player's game local: each player enters a
username, plays in their own browser, and only a start signal and the final
result (username, misses) cross the network. The winner has the fewest misses.
Nothing on the frame loop or audio path ever waits on the network.

## Adding a game

1. `games/<id>/game.json`: copy an existing one. `wii.units` are the decomp
   translation units to translate (see `third_party/rhf-decomp/config/SOME01/splits.txt`);
   `banks` are the cell-animation banks in the order the scene registers them;
   `scene` names the
   decomp's scene (`sceneVariant` picks one main chart when the scene has
   several); `perfectActive`, `chartTempo`, `projection` and `endsWithMusic`
   cover how the game plays and ends.
2. `adapters/<id>/game.h`: the scene constructor, init, update, flow command and
   wrong-input addresses and the flow constructor, plus any extra platform calls the game makes
   (`GAME_CALLS`) and per-frame hooks (`GAME_AFTER_UPDATE`). The build fails with
   the address of any call that is still missing.
3. `./build.sh <iso>` builds and tests every game that has a manifest.

## Other consoles (later)

A game from the GBA, DS or 3DS entries would get its own backend next to `wii`
(ROM reader, CPU translator, platform layer, asset and audio converters) and a
manifest naming that platform. The shell stays as it is.
