# Repository guidance

## Working conventions

- Use `agent-browser` first for browser work; read `.agents/skills/agent-browser/SKILL.md` before use. Its references and templates are bundled alongside it. The CLI must be installed separately.
- For HTML rendering, formatting, and UI changes, validate the rendered result and affected interactions in a browser. Iterate when the result differs from the intended behavior.
- Follow the existing Python, shell, C, and ES module style. There is no npm install step or JavaScript framework.
- Read `README.md` and `docs/engine.md` for current behavior. `docs/README.md` maps historical handoff paths to this repository; older notes are reference material and can be stale.

## Scope and fidelity

This project ports original Rhythm Heaven Fever minigames into standalone client-side browser games. It uses static PowerPC translation to WASM, hand-written Wii adapters, Canvas2D, and Web Audio, not a Dolphin runtime. Current game IDs are `golf` (Hole in One), `tap` (Tap Trial), and `rap` (Love Rap).

Preserve original timing windows, float operation order, scoring, and Perfect rules. Do not force results, widen windows, or enable rollback. Unsupported instructions and platform calls must be investigated rather than silently ignored. Do not describe static translation or fallback original objects as completed decompilation, or claim 1:1 fidelity from autoplay alone. Treat older notes about missing features as historical; inspect current code before relying on them.

## Source layout

- `games/<id>/game.json`: game manifests, original units, banks, sounds, timing, and projection.
- `adapters/wii/platform.c`: shared Wii services; `adapters/<id>/game.h`: game-specific addresses and hooks.
- `web/engine/`: shared page, clock, input, runtime, rendering, layouts, and audio. `web/index.html`: game picker.
- `tools/`: disc extraction, static translation, asset/audio conversion, chart discovery, staging, toolchain setup, and static server. Python tools select games with `RHF_GAME`.
- `third_party/rhf-decomp/`: pinned upstream submodule. Keep intentional local matching work in `patches/`; do not casually advance the submodule.
- `tests/`: timing classifiers and complete-level runtime checks.
- `build/`, `dist/`, `local/`, `.toolchain/`: ignored generated or private inputs and outputs. Edit source, then regenerate/stage outputs; do not implement fixes only in `dist/`.

## Build and run

Requires Python 3.10+ with `requirements.txt`, Node.js 18+, Git, Emscripten 5.0.7, and PowerPC binutils. `tools/setup-toolchain.sh` installs toolchain components into `.toolchain/`. The user supplies a USA SOME01 raw ISO and a Wii common key through the mechanisms documented in `README.md`. Only the explicitly authorized public common-key module may contain the key.

Run from the repository root:

```sh
git config core.hooksPath hooks
./build.sh "/absolute/path/to/Rhythm Heaven Fever (USA).iso"
./serve.sh --open
```

`build.sh` extracts, translates, builds WASM, converts assets, stages web sources, generates timelines, and tests all manifested games. `--skip-tests` is available for iteration, but run relevant checks before reporting success. Existing built outputs can be served without rebuilding. Use the server's printed URL.

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

These tests need generated `dist/` data. Centered autoplay expects 64 golf, 102 tap, and 31 rap cues with no failures; no-input runs check through counts. Shared runtime changes warrant testing all games. For browser changes, exercise Play, input, pause/resume, restart, and any affected transitions. Space and X must both map to A; click and standard gamepad A are supported. Chrome is the current validation target.

Use `web/engine/qa/audio-check.mjs` for relevant offline audio checks, and inspect actual sound when changing playback. Avoid audible automated tests during the user's gameplay; pause/close test contexts afterward and leave pages ready to Play. Report missing prerequisites or checks you could not run. Software frame costs and browser-reported audio latency do not establish physical click-to-photon or acoustic latency.

## Git and game material

The user authorizes publishing the compiled game runtime, including statically translated game code/WASM, for GitHub Pages. The hosted player should import assets and required original data locally from the user's ISO. This overrides the earlier blanket prohibition on publishing generated runtime code. Never publish disc images, original executables, Nintendo archives, extracted charts/media, original data segments, or unrelated key material. The user explicitly authorized bundling the public Wii common key in `web/import/common-key.mjs` and its generated Pages copy `import/common-key.mjs`; this is the only key-publication exception. Do not import the outer workspace's reference material into tracked paths.

The clean-material checker allows only `runtime-src/{golf,tap,rap}/original-functions.inc` translated-code snapshots. WASM remains excluded from tracked source; CI compiles it into the ignored `site/` artifact, which `scripts/check-pages.py` audits. See `docs/pages.md` for the importer, cache compatibility, and Pages workflow. Retain asset and original-data protections and the key check outside that exact public module.

Keep `hooks/pre-commit`, `.gitignore`, and `scripts/check-clean.py` effective. Before committing, inspect the diff and run `python3 scripts/check-clean.py --staged` after staging the intended files. The tracked-file check also runs in GitHub Actions on pushes and pull requests; passing it without local disc references does not perform the optional comparison against extracted disc bytes.
