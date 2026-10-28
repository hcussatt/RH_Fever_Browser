# Repository guidance

## Working conventions

- Use `agent-browser` first for browser work; read `.agents/skills/agent-browser/SKILL.md` before use. Its references and templates are bundled alongside it. The CLI must be installed separately.
- For HTML rendering, formatting, and UI changes, validate the rendered result and affected interactions in a browser. Iterate when the result differs from the intended behavior.
- Follow the existing Python, shell, C, and ES module style. There is no npm install step or JavaScript framework.
- Write in American English (practice, color, center, canceled, behavior) in UI text, docs, comments and commit messages. Convert older British spellings when you touch those lines.
- Read `README.md` and `docs/engine.md` for current behavior. `docs/README.md` maps historical handoff paths to this repository; older notes are reference material and can be stale.

## Scope and fidelity

This project ports original Rhythm Heaven Fever minigames into standalone client-side browser games. It uses static PowerPC translation to WASM, hand-written Wii adapters, Canvas2D, and Web Audio, not a Dolphin runtime. The game IDs are the manifests under `games/` (`golf` Hole in One, `tap` Tap Trial, `rap` Love Rap, `agbghost` Sneaky Spirits, `robot` Screwbot Factory, `seesaw` See-Saw, `date` Double Date, `rocket` Launch Party, `concons` Donk-Donk, `receive` Bossa Nova, `bun` Working Dough, `seal` Built to Scale, `badminton` Air Rally, `muscle` Figure Fighter, `taptroupe` Tap Troupe, `shrimp` Shrimp Shuffle, `panel` Cheer Readers, `karateman` Karate Man, `fork` Fork Lifter, `tambourine` Tambourine, `rotation` Board Meeting, `watch` Monkey Watch, `interview` Ringside, `sort` Packing Pests, `flea` Micro-Row, `samurai` Samurai Slice, `fishing` Catch of the Day, `goma` Flipper-Flop, `batting` Exhibition Match, `birds` Flock Step, the "2" versions `samurai2` Samurai Slice 2, `bun2` Working Dough 2, `seal2` Built to Scale 2, `date2` Double Date 2, `rap2` Love Rap 2, `panel2` Cheer Readers 2, `golf2` Hole in One 2 and `robot2` Screwbot Factory 2, and the remixes `remix1` to `remix9`).

Preserve original timing windows, float operation order, scoring, and Perfect rules. Do not force results, widen windows, or enable rollback. Unsupported instructions and platform calls must be investigated rather than silently ignored. Do not describe static translation or fallback original objects as completed decompilation, or claim 1:1 fidelity from autoplay alone. Treat older notes about missing features as historical; inspect current code before relying on them.

## Source layout

- `games/<id>/game.json`: game manifests, original units, banks, sounds, timing, and projection.
- `adapters/wii/platform.c`: shared Wii services; `adapters/<id>/game.h`: game-specific addresses and hooks.
- `web/engine/`: shared page, clock, input, runtime, rendering, layouts, and audio. `web/index.html`: game picker.
- `install/`: one-step prerequisite installers for macOS, Windows (WSL) and Ubuntu/Debian.
- `tools/`: disc extraction, static translation, asset/audio conversion, chart discovery, staging, toolchain setup, and static server. Python tools select games with `RHF_GAME`.
- `third_party/rhf-decomp/`: pinned upstream submodule. Keep intentional local matching work in `patches/`; do not casually advance the submodule.
- `tests/`: timing classifiers and complete-level runtime checks.
- `build/`, `dist/`, `local/`, `.toolchain/`: ignored generated or private inputs and outputs. Edit source, then regenerate/stage outputs; do not implement fixes only in `dist/`.

## Build and run

Requires Python 3.10+ with `requirements.txt`, Node.js 18+, Git, Emscripten 5.0.7, and PowerPC binutils. `tools/setup-toolchain.sh` installs toolchain components into `.toolchain/`. `install/` holds the one-step prerequisite installers (`macos.command`, `windows.ps1` via WSL Ubuntu, `linux.sh`), which all end in `install/finish.sh`; keep them in step with any new build prerequisite, download only from official sources, and never download game material. Node.js comes from Emscripten's bundle when none is installed (`tools/env.sh`). The user supplies a USA SOME01 raw ISO and a Wii common key through the mechanisms documented in `README.md`. Only the explicitly authorized public common-key module may contain the key.

Run from the repository root:

```sh
git config core.hooksPath hooks
./build.sh "/absolute/path/to/Rhythm Heaven Fever (USA).iso"
./serve.sh --open
```

`build.sh` extracts, translates, builds WASM, converts assets, stages web sources, generates timelines, and tests all manifested games. It builds games side by side (`tools/build-game.sh`, one per CPU core; `RHF_JOBS` overrides) with each game's log in `build/logs/`. It keeps the DOL disassembly (`build/disasm/`) and decoded DSP samples (`build/cache/dsp/`) keyed by their exact inputs, and `tools/build-core.sh` skips emcc when every file of the last compile, its flags and the emcc version are unchanged. These caches never change output; bump `DSP_VERSION` in `tools/nintendo_audio.py` if `decode_dsp` output ever changes. `--skip-tests` is available for iteration, but run relevant checks before reporting success. Existing built outputs can be served without rebuilding. Use the server's printed URL.

For web-only iteration, `tools/stage-web.sh <game>` copies engine source, the game page, and manifest to `dist/`; `tools/stage-index.sh` refreshes the picker. Changes to code, assets, or charts require the corresponding build pipeline steps.

## Validation

After building, run checks appropriate to the changed game or shared layer:

```sh
node tests/test-golf-timing.mjs
node tests/test-tap-timing.mjs
node tests/test-runtime.mjs golf
node tests/test-runtime.mjs golf --auto
node tests/test-runtime.mjs tap
node tests/test-runtime.mjs tap --auto
node tests/test-runtime.mjs rap
node tests/test-runtime.mjs rap --auto
python3 scripts/check-clean.py
```

Run the same pair (`test-runtime.mjs <id>` and `--auto`) for every other manifested game, plus `node tests/test-sequence.mjs` after audio or sequence changes. These tests need generated `dist/` data. Centered autoplay expects every cue hit with no failures (the expected cue count per game is in `tests/test-runtime.mjs`); no-input runs check through counts. Shared runtime changes warrant testing all games. For browser changes, exercise Play, input, pause/resume, restart, and any affected transitions. Space and X must both map to A; click and standard gamepad A are supported. Chrome is the current validation target.

Use `web/engine/qa/audio-check.mjs` for relevant offline audio checks, and inspect actual sound when changing playback. Avoid audible automated tests during the user's gameplay; pause/close test contexts afterward and leave pages ready to Play. Report missing prerequisites or checks you could not run. Software frame costs and browser-reported audio latency do not establish physical click-to-photon or acoustic latency.

## Git and game material

The user authorizes publishing the compiled game runtime, including statically translated game code/WASM, for GitHub Pages. The hosted player should import assets and required original data locally from the user's ISO. This overrides the earlier blanket prohibition on publishing generated runtime code. Never publish disc images, original executables, Nintendo archives, extracted charts/media, original data segments, or unrelated key material. The user explicitly authorized bundling the public Wii common key in `web/import/common-key.mjs` and its generated Pages copy `import/common-key.mjs`; this is the only key-publication exception. Do not import the outer workspace's reference material into tracked paths.

The clean-material checker allows only `runtime-src/<id>/original-functions.inc` translated-code snapshots for registered manifests with `web.enabled: true`. WASM remains excluded from tracked source; CI compiles it into the ignored `site/` artifact, which `scripts/check-pages.py` audits. See `docs/pages.md` for the importer, cache compatibility, and Pages workflow. Retain asset and original-data protections and the key check outside that exact public module.

Keep `hooks/pre-commit`, `.gitignore`, and `scripts/check-clean.py` effective. Before committing, inspect the diff and run `python3 scripts/check-clean.py --staged` after staging the intended files. The tracked-file check also runs in GitHub Actions on pushes and pull requests; passing it without local disc references does not perform the optional comparison against extracted disc bytes.

## Owner's standing rules

These come from the repository owner and apply to every contributor and agent.

- Nothing copyrighted goes into git: no ISO, executable, extracted assets, textures, audio, charts or Nintendo code beyond the translated-code snapshots allowed above. Every feature must work only from the ISO a user supplies.
- Ask the owner before deleting any file, every time. Approval for one deletion does not cover the next.
- Pushing branches and opening pull requests is fine without asking. Never merge a pull request; merging is the owner's alone.
- Hosted site freeze: new games stay `web.enabled: false` (no `runtime-src/` snapshot) until the owner says otherwise. Screwbot Factory stays off the hosted site.
- Downloads: well-known GitHub pages are fine; anything else from the internet needs the owner's permission first.
- Controls: A is Space, Left Shift, X, left click or gamepad A; B is Right Shift, right click or gamepad B.
- Audio correctness is the top priority, then stability and latency. Every sound must play exactly as the original.
- Do not write model names or versions into the repository. The README's AI-use disclosure stays.

## Working with the owner

- Lead every status or plan with what is needed from the owner, or say nothing is needed.
- Warn before work likely to use more than about 5% of the owner's usage limits, with short, confident time estimates per step.
- Say when a setup step (an install or download) would be much faster done by hand.
- Keep full play-through tests to a minimum; prefer the headless runtime tests and short screenshot runs.
- When a change breaks things, fully fix the game or remix being worked on before retesting other games.

## Porting a minigame

1. Find the scene in the decomp (`src/Game/SceneManager.hpp`) and write `games/<id>/game.json` (units, banks, cellanim, scene variant) and `adapters/<id>/game.h` (scene constructor, init, update, flow command, wrong input, flow create).
2. Build with `tools/recompile.py`, `tools/build-core.sh`, `tools/chart-index.py`, the extract tools, `tools/stage-web.sh` and `tools/chart-timeline.mjs`. Each panic names an unsupported instruction or a missing platform call: trace it to the original code and implement it faithfully. Never add a silent `break;` stub without a comment saying why the original's effect is not needed.
3. Check the cue count is real. Checkers that take no press, are withdrawn before their beat, or score nothing are not cues (see `docs/engine.md`). Add the expected count to `tests/test-runtime.mjs`.
4. Audio checklist: every sound the game plays exists in `sfx.json`; every input case (clean hit, slightly early or late, full miss, stray press, no input) plays only known sounds; live hit and miss sounds land on their chart tick; extractors and tracers raise on any unmodelled sequence command; listen for gaps inside spoken words.
5. Input checklist: hit and miss handlers get the real input type; check each cue's input type (A, B, A+B, releases); test keys and mouse in Chromium.
6. Screenshots in Chromium through every input case. Look for black frames, missing layouts and text, and placeholder graphics.
7. After any shared change, diff every other game's `original-timeline.json` and autoplay sound log against a baseline build, and run their runtime tests.

## Porting a remix

1. Port each source minigame standalone first. A minigame belongs to the remix whose graphics it has on the disc (`cellanim/<game>/remixNN`).
   A "2" version (the song select's rows 8 and 9) is the same scene with its other main chart: `sceneVariant` picks it (the scene-load version before it, see `tools/chart-index.py`), its graphics are `cellanim/<game>/ver1`, and its `adapters/<id>/game.h` includes the first version's. Its scene version can need code the first version never calls (Working Dough 2's `Game/WindParticle.cpp`) or banks its graphics add (Love Rap 2's `rap_chandelier`, Screwbot Factory 2's `robot_shadow` and `spot`).
2. Write the remix manifest (music, `wii.scenes` with each game's remix cellanim, the epilogue) and an `adapters/<id>/game.h` that includes `scenes.h`. Add the set to `web/engine/menu.mjs`.
3. Check the entry chart's prelude sounds (`SE_REMIX_MODE_SET_REMIXn` sets sequence variable 22, which changes some games' sounds in remixes) and every scene's layouts (game layouts, the speech balloon, a game's own message layout).
4. Test the remix first and fix it fully before retesting the standalone games: headless runtime tests, one keyboard autoplay in Chromium with screenshots across every scene, the results screen, and per-section sound comparison against each standalone game.
5. Known remix pitfalls: TickFlow rest-slot defaults (32/16/16/8), scene changes ending the old scene's banks and animations, chart message panes and the layouts that register them, layout animations a scene relies on (Hole in One's screen frame), grading flows not running in game frames, and actors attached to a scene's base canvas.
6. Bulk ports (a remix and its minigames in one go): port and test each minigame, then the remix, then rebuild every game once and diff each `original-timeline.json` and autoplay sound log against a copy saved before the change. Recheck what earlier bulk ports got wrong:
   - Cue counts: a checker withdrawn before its beat, or one that scores nothing (a partner's), is not a cue; compare autoplay hits with the scoring events, not the checker count. A no-input run can pass fewer cues than exist when a miss ends a sequence (Built to Scale's dropped rods).
   - Silent chart commands: list every ExFlow op a chart reaches (the CExFlow jump table at `0x802ed48c`) and handle or document each one; an op that falls through `exflow_command` is a silent stub. Remix 3 needed the screen mask (0x112-0x116), the in-play fader (0x10A) and the lyric layout's title card (0x13B). Remix 8 needed its photo frame (0x13F, `remix/ver8/cellanim.szs`, bank 253 in the port because the original's 254 is the port's permanent bank).
   - Scene version (`sceneVersion` in the chart index) gates behaviour: check it before "fixing" a difference between a solo game and its remix scene.
   - Black or missing scenes: actor caps in the renderer, per-scene layouts, and anything the original shows only before the music starts.
   - Sounds: the remix mode sound (`SE_REMIX_MODE_SET_REMIXn`) and each scene's sounds against its solo game.
   - Sound slides and held, wavering notes (sirens, calls): `node tests/test-sequence.mjs` must match and `tools/extract-sfx.py` must not raise; listen to them. A note's later volume, pan and bend changes are its `changes`.
   - Pitch sweeps and portamento (0xe3, 0xc9, 0xce, 0xcf): a note's `sweep` returns over its `sweepMs` (from the porta time), or over its ticks when there is none. A sweep running far too fast sounds like peaking (Shrimp Shuffle's step sound).
   - Layout panes with a different vertex colour at each corner, and TEV stages after one with no colour channel: check screenshots for flat strips or missing panes (Shrimp Shuffle's shore, wet sand and starfish).
   - Per-frame tint changes (an actor's fore/back colour, `0xa0`-`0xa5`, changing every frame, like Air Rally's clouds): count them headless and never read pixels back per frame (`colored()` in `renderer.mjs` blends into reused canvases).
   - A+B cues followed by a release (Karate Man's charged kick): the test harness holds A+B until the release cue arms; a no-input run can pass extra checkers that take no input (`checkers` in `tests/test-runtime.mjs`).
   - Looping flows and the results screen: run `node tests/test-grading.mjs` with every game's id (with no ids it checks only the web-enabled games) and confirm each results screen can be left. A game's own looping flow must end when the results start, as the original's scene exit does (Monkey Watch and Launch Party stayed stuck on the results).
   - After merging main, refresh the enabled games' snapshots with `python3 tools/prepare-pages.py --snapshot`; new games stay web-disabled.
   - Scenes only a remix reaches (Remix 10's navigator, `navi`): `sceneOnly` in the manifest, never web-enabled; another game's archive the scene also loads goes in `extraCellanims` (the navigator's metronome).
   - Layouts a game's own code drives (Night Walk's sky, `NightWalk::CMyLayout`): leave the unit untranslated and emulate it in `GAME_CALLS` as layout events; `layout.animations` and `layout.panes` take `%02d` names with `{count}` for numbered panes, and actions from `0x10000` up carry 16-bit indices. A game whose own layout is not the lyric layout lists that one as `lyricLayout` (its song title card).
   - A level a miss can end early (Night Walk's fall) ends where the live run does; its timeline lasts as long as an all-hit run. A level with no results screen (Night Walk, `results: false`) returns to the library.

## Roadmap

- Next: the remaining remixes, each with its source minigames, following the steps above.
- Planned: a settings menu with separate volume controls for the music and the sound effects (Henry, 2026-10-27).
- Done: each game's practice plays before the song, as in the original, unless the game select switch "Skip practice" is on (default off; Henry, 2026-10-28). Not yet drawn: the practice counter, the A-button icon beside waiting lines and the "(-) Skip" graphic; Night Walk's practice (its own night sky) is left out. See docs/engine.md, Practice.
- Done: Power Calligraphy (`agbkanji`) and The Clappy Trio (`agbclap`) under Other games (Henry, 2026-10-27).
- Done: the Rhythm Test (`calibrate`) sets the audio delay for wireless headphones, with a reset to default in both menus (Henry, 2026-10-27; see docs/engine.md, Timing model).
- Versus mode (docs/multiplayer.md): each player plays in their own session under a username. The host picks one game or a match: a remix set (that song-select row's minigames, then its remix) or Shuffle (three random version 1 minigames, one random "2" game, then a random remix; Henry 2026-10-28). Each song scores 0-100 (the original's per-category hit rate, averaged); the match total wins, ties go to fewer missed cues, then Superbs, then Perfects (web/engine/versus.mjs, Henry's choice 2026-10-28). Networking must never touch local timing or audio.
- Later and low priority: room for mods and custom charts, a live versus view, and minigames from other Rhythm Heaven entries (GBA, DS, 3DS) as new console backends after Fever is done.

## CI/CD and publishing new games to Pages

The owner's standing rules above take precedence over this section: the hosted-site freeze decides which games are enabled, and only the owner merges pull requests.

A completed, playable minigame is expected to ship in the Pages app, not only in
local `dist/`. Preserve existing published games while adding new ones. Keep a
prototype's `web.enabled` false until it passes local gameplay/asset qualification;
then explicitly enable it as part of completing the port.

- Register the game in `games/<id>/game.json` using `schemas/game.schema.json`.
  Set `web.enabled`, `web.expectedCues`, and `web.order`, and supply the `wii`
  adapter/asset metadata described in `docs/game-modules.md`. Do not
  maintain separate hard-coded game lists in the picker, worker, or workflow.
- Build from the local USA ISO and test actual input, timing, audio, complete
  results/epilogue transitions, and Perfect outcomes. Add or extend runtime and
  grading coverage for the new game. Browser/autoplay checks alone do not prove
  Wii-identical behavior. Keep automated audio silent during user gameplay.
- Refresh the approved translated snapshot with
  `python3 tools/prepare-pages.py --snapshot` after a local build. A web-enabled
  game needs `runtime-src/<id>/original-functions.inc`; remixes also need the
  generated `runtime-src/<id>/scenes.h`. CI compiles their WASM
  without an ISO. Keep importer dependencies in the source archive current and
  verify a fresh import works without a decomp checkout or local build files.
- Validate registration with `python3 tools/game_registry.py` and
  `python3 tests/test_game_registry.py`. Run source/public policy checks,
  `python3 scripts/check-pages.py` on the staged artifact, and `npm test`.
  Never add the ISO, charts, original data segments, or extracted media to Git
  or the public site. The exact public common-key module is the sole key exception.
- `.github/workflows/pages.yml` discovers enabled games, compiles each through
  its generated Actions matrix, assembles/audits `site/`, and runs browser
  integration tests on PRs. Require these checks on the final merged tree;
  resolving conflicts or changing source requires a fresh successful run.
- Merge the tested PR into `hcussatt/RH_Fever_Browser:main` to trigger deployment.
  A successful PR build does **not** update the live website. The main-branch
  workflow must finish its deploy job successfully; Pages should use GitHub
  Actions as its publishing source. Do not manually publish `dist/` or assets.
- Verify the actual deployed app at
  `https://hcussatt.github.io/RH_Fever_Browser/`, including the new catalog entry
  and ISO import path, before calling it shipped. A service-worker update waits
  for existing app tabs to close; reopen the app to see the new shell. Runtime
  or converter changes may require ISO reimport through the compatibility check.
  Do not clear the user's imported data merely to refresh the UI.
