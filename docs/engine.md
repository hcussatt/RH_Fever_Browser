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
   `sounds`/`soundGroups`/`music` select the BRSAR data; `afterPrelude`,
   `chartTempo`, `projection` and `endsWithMusic` cover how the game starts and ends.
2. `adapters/<id>/game.h`: the scene constructor, init, update, flow command and
   wrong-input addresses, plus any extra platform calls the game makes
   (`GAME_CALLS`) and per-frame hooks (`GAME_AFTER_UPDATE`). The build fails with
   the address of any call that is still missing.
3. `tools/<id>-timeline.py`: the chart tracer (until the general chart player lands).
4. `./build.sh <iso>` builds and tests every game that has a manifest.

## Other consoles (later)

A game from the GBA, DS or 3DS entries would get its own backend next to `wii`
(ROM reader, CPU translator, platform layer, asset and audio converters) and a
manifest naming that platform. The shell stays as it is.
