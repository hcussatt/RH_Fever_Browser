# Notes

These files come from the previous developer's handoff and describe the older
workspace layout (`vendor/wasm-dolphin/`, `research/`, `start-golf.sh`). In this
repository those paths map to:

| Old | Now |
| --- | --- |
| `research/original/main.dol` | `build/disc/main.dol`, read from your ISO |
| `research/rhf-decomp/` | `third_party/rhf-decomp/` plus `patches/rhf-decomp-local.patch` |
| `research/<game>/recompiled/runtime.c` | `adapters/wii/platform.c` (shared) + `adapters/<game>/game.h` |
| `vendor/wasm-dolphin/<game>/` | `web/engine/` + `games/<game>/game.json` (source) and `dist/<game>/` (built) |
| `tools/test-<game>-runtime.mjs` | `node tests/test-runtime.mjs <game>` |
| `tools/test-<game>-timing.mjs` | `tests/test-<game>-timing.mjs` |
| `tools/recompile-golf.py` + `RHF_STANDALONE_GAME` | `tools/recompile.py` + `RHF_GAME` |
| `tools/extract-golf.py`, `extract-tap.py` | `tools/extract-disc.py` + `tools/extract-assets.py` |
| `start-golf.sh`, `start-tap.sh` | `./serve.sh` |

How the shared engine is put together, and how to add a game: [engine.md](engine.md).
