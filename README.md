# Rhythm Heaven Fever for the browser

Standalone browser versions of Rhythm Heaven Fever minigames, built from the
community decompilation and from your own copy of the game. The long-term goal
is a real-time multiplayer mod.

Playable today: **Hole in One** and **Tap Trial**.

## No game files in this repository

This repository contains only original tooling, adapters and page code. It has
no game executable, graphics, charts, sounds or translated game code, and it
will not run without a disc image you supply. `./build.sh` reads everything it
needs from your ISO into `build/` and `dist/`, which git ignores.

`scripts/check-clean.py` blocks commits that contain disc images, executables,
Nintendo formats, WASM, decoded media, translated game code, the Wii common key,
or any 64-byte run copied from your `main.dol`. Turn the hook on once per clone:

```sh
git config core.hooksPath hooks
```

The same check runs on every push in GitHub Actions.

## What you need

- Your own **Rhythm Heaven Fever (USA)** disc as a raw `.iso` (game ID SOME01,
  4,699,979,776 bytes). RVZ/WBFS images must be converted to ISO first.
- The Wii common key (see below).
- Python 3.10+ with `numpy`, `Pillow` and `cryptography`, Node.js 18+, git.
- Emscripten 5.0.7 and PowerPC binutils: `tools/setup-toolchain.sh` downloads both into `.toolchain/`.

## Build and play

```sh
git clone --recurse-submodules <this repo> rhf-web && cd rhf-web
git config core.hooksPath hooks
tools/setup-toolchain.sh
./build.sh "/path/to/Rhythm Heaven Fever (USA).iso"
./serve.sh --open
```

Open the printed URL in Chrome and pick a game. Space, X, click or gamepad A
plays; Escape pauses. Click once first so the browser allows sound.

## Wii common key

The ISO's game partition is encrypted with the Wii common key, which is not
included here. Provide it in one of these ways:

- put the 32 hex digits in `local/wii-common-key.txt` (git-ignored),
- set `RHF_WII_COMMON_KEY`, or
- set `RHF_DOLPHIN_IOSC` to `Source/Core/Core/IOS/IOSC.cpp` in a Dolphin source checkout.

## Layout

| Path | What it is |
| --- | --- |
| `build.sh`, `serve.sh` | Build everything from the ISO; serve `dist/` locally |
| `tools/extract-disc.py` | Reads `main.dol`, cellanim archives and the sound archive from the ISO, checking the executable's SHA1 |
| `tools/recompile.py` | Translates each game's original PowerPC functions to C (per-game profiles) |
| `tools/build-core.sh` | Compiles that C plus the hand-written adapter to WASM |
| `tools/extract-assets.py`, `extract-sfx.py`, `decode-music.py` | Textures, cell animations, sound programs, samples and music |
| `tools/golf-timeline.py`, `tap-timeline.py` | Trace each game's original rhythm chart |
| `adapters/<game>/runtime.c` | Hand-written platform services the translated code calls |
| `web/<game>/` | Page, renderer, input and Web Audio code |
| `tests/` | Timing-window and full-level tests (run by `build.sh`) |
| `third_party/rhf-decomp` | [conhlee/rhf](https://github.com/conhlee/rhf) decomp (CC0), pinned; `patches/` holds local matching work |
| `docs/` | Notes from the previous developer, including the original handoff brief |

## Status and limits

This is a proof of concept, not a certified 1:1 port. Original timing windows
and Perfect rules are kept; nothing widens windows or forces scores. Audio uses
the original samples through a provisional mixer. See `docs/golf-notes.md`,
`docs/tap-notes.md` and `docs/handoff-START_HERE.md` for the full list.
