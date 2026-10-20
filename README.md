# Rhythm Heaven Fever for the browser

Standalone browser versions of Rhythm Heaven Fever minigames, built from the
community decompilation and from your own copy of the game. The long-term goal
is a real-time multiplayer mod.

> **AI disclosure.** All of the code in this repository was written by Claude
> (Anthropic) through Claude Code. A human tests every major build. This project
> is primarily a work of AI.

Playable today: **Hole in One**, **Tap Trial**, **Love Rap**, **Sneaky Spirits**,
**Screwbot Factory**, **See-Saw**, **Double Date**, **Remix 1**, **Launch Party**,
**Donk-Donk**, **Bossa Nova** and **Remix 6**. The game picker
lists them by remix set, as the original song select does.

## Runtime code here; assets stay local

The hosted player publishes the engine and compiled game runtime. Approved
translated C snapshots in `runtime-src/` let CI compile that runtime without an
ISO. Graphics, charts, sound, original data sections, the original executable
are not published. The public Wii common key is bundled as authorized; players
select only their own ISO.
an asset converter runs in a browser worker and stores prepared games locally.
The ISO is read in slices, never uploaded or copied wholesale into browser storage.

`scripts/check-clean.py` blocks commits that contain disc images, executables,
Nintendo formats, decoded media, the Wii common key, and original binary data.
Only registered web games’ `runtime-src/<game>/original-functions.inc` code snapshots
are exempt from the generated-code rule. A separate deployment audit checks the
public output, allowing only the compiled per-game WASM artifacts. Turn the hook on once per clone:

```sh
git config core.hooksPath hooks
```

The same check runs on every push in GitHub Actions.

## GitHub Pages

See [deployment and validation](docs/pages.md). Pushes to `main` build and test the
public player, audit its contents, and deploy it to Pages. Pull requests build
and test the same artifact without deploying. A repository administrator must
select **Settings → Pages → Source → GitHub Actions** once.

The hosted player needs a desktop browser, your ISO; no local Python,
Node or compiler is needed. The first import downloads pinned Pyodide 0.27.7 and
its NumPy/Pillow/cryptography packages. Prepared assets use browser Cache Storage.
After import and successful service worker installation, the runtime can load
offline. Browser storage may be cleared or evicted; persistent storage is requested.
UI-only updates preserve compatible asset imports. Changed runtimes/converters
can require reimport. There is no built-in Internet Archive downloader.

## What you need

- Your own **Rhythm Heaven Fever (USA)** disc as a raw `.iso` (game ID SOME01,
  4,699,979,776 bytes). RVZ/WBFS images must be converted to ISO first.
- The Wii common key is bundled for the Pages importer; local builds use it by default too.
- Python 3.10+ with `numpy`, `Pillow` and `cryptography`, Node.js 18+, git.
- Emscripten 5.0.7 and PowerPC binutils: `tools/setup-toolchain.sh` downloads both into `.toolchain/`.

## Build and play

```sh
git clone --recurse-submodules <this repo> rhf-web && cd rhf-web
git config core.hooksPath hooks
# Use an installed Python 3.10+ executable here; macOS /usr/bin/python3 may be 3.9.
python3.11 -m venv .venv
.venv/bin/python3 -m pip install -r requirements.txt
tools/setup-toolchain.sh
./build.sh "/path/to/Rhythm Heaven Fever (USA).iso"
./serve.sh --open
```

Open the printed URL in Chrome and pick a game. A is Space, Left Shift, X, left
click or gamepad A; B is Right Shift, right click or gamepad B (Screwbot Factory,
and its part of Remix 1, wants A and B together). Escape pauses. Click once first so the browser allows
sound.

The build and installer automatically use `.venv` when present, otherwise they
look for Python 3.10+ on PATH. `RHF_PYTHON=/path/to/python3` overrides that choice;
the same interpreter is passed to Emscripten. If installation previously stopped
with an old-Python error, rerun `tools/setup-toolchain.sh` after fixing Python.

## Wii common key

The Pages importer includes the Wii common key, so visitors only select their
ISO. Its publication was explicitly authorized by the user. The same bundled
module is the local builder's default. To override it:

- put the 32 hex digits in `local/wii-common-key.txt` (git-ignored),
- set `RHF_WII_COMMON_KEY`, or
- set `RHF_DOLPHIN_IOSC` to `Source/Core/Core/IOS/IOSC.cpp` in a Dolphin source checkout.

## Layout

| Path | What it is |
| --- | --- |
| `build.sh`, `serve.sh` | Build everything from the ISO; serve `dist/` locally |
| `tools/extract-disc.py` | Reads `main.dol`, cellanim archives and the sound archive from the ISO, checking the executable's SHA1 |
| `games/<game>/game.json` | Each game's manifest: title, original code units, banks, sounds, timing options |
| `tools/recompile.py` | Translates each game's original PowerPC functions to C |
| `tools/build-core.sh` | Compiles that C plus the Wii platform backend to WASM |
| `tools/extract-assets.py`, `extract-sfx.py`, `decode-music.py` | Textures, cell animations, sound programs, samples and music |
| `tools/chart-index.py`, `chart-timeline.mjs` | Find each game's chart and tempo in the executable; dry-run it to pre-schedule its sounds |
| `adapters/wii/platform.c` | Hand-written Wii platform services the translated code calls, shared by every game |
| `adapters/<game>/game.h` | The original addresses and game-specific calls one game needs |
| `web/engine/` | Shared page, clock, input, renderer and Web Audio code |
| `tests/` | Timing-window and full-level tests (run by `build.sh`) |
| `third_party/rhf-decomp` | [conhlee/rhf](https://github.com/conhlee/rhf) decomp (CC0), pinned; `patches/` holds local matching work |
| `docs/` | [How the engine works](docs/engine.md), plus notes from the previous developer |

## Status and limits

This is a proof of concept, not a certified 1:1 port. Original timing windows
and Perfect rules are kept; nothing widens windows or forces scores. Audio uses
the original samples, note envelopes and volume rules; pitch interpolation, LFO
and filters are still approximated by Web Audio. Original grading and epilogue screens are implemented for the registered ports; see
[results behavior and verification](docs/results.md). Love Rap's lyric captions
use the original layout. See `docs/golf-notes.md`,
`docs/tap-notes.md` and `docs/handoff-START_HERE.md` for the full list.
