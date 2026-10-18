# Notes

These files come from the previous developer's handoff and describe the older
workspace layout (`vendor/wasm-dolphin/`, `research/`, `start-golf.sh`). In this
repository those paths map to:

| Old | Now |
| --- | --- |
| `research/original/main.dol` | `build/disc/main.dol`, read from your ISO |
| `research/rhf-decomp/` | `third_party/rhf-decomp/` plus `patches/rhf-decomp-local.patch` |
| `research/<game>/recompiled/runtime.c` | `adapters/<game>/runtime.c` |
| `vendor/wasm-dolphin/<game>/` | `web/<game>/` (source) and `dist/<game>/` (built) |
| `tools/recompile-golf.py` + `RHF_STANDALONE_GAME` | `tools/recompile.py` + `RHF_GAME` |
| `tools/extract-golf.py`, `extract-tap.py` | `tools/extract-disc.py` + `tools/extract-assets.py` |
| `start-golf.sh`, `start-tap.sh` | `./serve.sh` |
