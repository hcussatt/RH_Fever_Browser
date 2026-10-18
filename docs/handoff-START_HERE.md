# Rhythm Heaven Fever — native browser port handoff

**Read this document first.** Give this ZIP and the user's separate USA Wii ISO to the next Claude/Codex. This is the authoritative continuation brief; older research notes are supporting evidence and may describe obsolete emulator work.

## The assignment

Continue extracting, reverse-engineering/decompiling, and porting original Rhythm Heaven Fever minigames into standalone browser implementations. **Do not resume the Dolphin browser-emulator project.** The user cares about original-game behavior, assets, scoring, audio and timing, not a clone. Static recompilation is an accepted interim bridge while readable source recovery proceeds. Do not call generated C or original fallback objects a completed decompilation.

Work autonomously without routine questions. Prioritize playable individual levels and reuse the existing tools. Desktop Chrome on a reasonably capable Mac/PC is mandatory; Safari/Firefox are intended future targets, mobile is not required. Everything must run client-side and be served as static files through a simple shell script. Space and X must both map to Wii A; click and standard gamepad A are implemented. Preserve the original timing windows and Perfect rules. No score forcing, widened windows, rollback or historical scoring correction. Timestamp-correction ideas are FUTURE USE ONLY in `research/timing/FUTURE-USE.md`.

Leave all available levels unlocked/directly playable; progression can return later. Original whole-game save/import/export work belonged to the excluded emulator: it has **not** been implemented for these native PoCs. Avoid introducing server-side gameplay, heavy UI or unrelated menus. Do not let automated test audio play over the user's gameplay. Pause/stop test contexts, reset pages to Play, and stop your tests when asked.

## What is actually working

Two self-contained static browser PoCs are included:

| Level | Directory | Native functions / code | Complete automated Chrome run |
|---|---|---|---|
| Hole in One (internal `Baseball`) | `vendor/wasm-dolphin/golf/` | 134 / 27,444 original PPC instruction bytes | 64/64 hits, no miss or Perfect failure |
| Tap Trial (internal `AgbTap`) | `vendor/wasm-dolphin/tap/` | 108 / 16,840 bytes | 102/102 hits, no miss or Perfect failure |

The `vendor/wasm-dolphin` path is a historical directory name. These two PoCs do **not** execute Dolphin, emulate Wii hardware, fetch/decode instructions, or load an ISO at runtime. Their browser dependencies are their own generated WASM, extracted assets, Canvas2D, and Web Audio. The only server code is a static HTTP server. Do not confuse this directory name with the technology in use.

Run from the extracted project root:

```
./start-golf.sh --open
./start-tap.sh --open
```

Requires Node.js 18+. The static server uses 8080 or the next available port; each command prints its actual URL. If both run, they usually use different ports. A running original workspace server previously exposed `/golf/` and `/tap/`; that server is not part of a newly extracted bundle. Use the printed URLs. Space/X/click/gamepad button 0 plays; Escape pauses. Switching tabs pauses. Browser audio requires a user gesture.

Existing browser binaries play **without installing Emscripten or rebuilding the decomp**. Synthetic keyboard tests also passed. Physical gamepad, Safari, click-to-photon, and acoustic latency have not been qualified.

Measured Chrome update/draw p95: golf .320 ms, Tap Trial .145 ms. These are software processing costs, not total input/display latency. Browser-reported base/output latency during tests was 5.33/32 ms; do not add these numbers and claim a measured physical latency.

## Honest fidelity status

This is a proof of concept, not a certified 1:1 port. The original gameplay/checker instructions execute through a limited static PPC-to-C-to-WASM translation. Original images, animation keys, musical charts and sound samples are used. Platform services and some manager behavior are adapted/stubbed. The full practice/prologue, original result screens, original grading scores, full Perfect-attempt lifecycle/icons/failure jingle, balloon text and some layout transitions are missing. Footer counts are diagnostics. Original final-score fidelity has **not** been established.

Audio is the biggest remaining quality/parity task. PCM music is decoded from original RWAV DSP-ADPCM. SFX use original RSEQ entry points and samples through a **provisional Web Audio mixer**. Envelope/release, volume, pan, portamento/tie/LFO/filter/effects, randomness, automation after note start and resampling are not fully faithful. Zero clipping is not proof that it sounds like the Wii. Matched native/original-hardware audio comparison is still needed.

Digital full-autoplay renders passed: golf 110 s stereo 48 kHz, zero clipped/nonfinite samples, peak .80187; Tap Trial same duration/rate, zero clipping, peak .69546. Golf's DSP format was independently checked against FFmpeg via GENH. Nintendo rounds its predictor while FFmpeg truncates; do not falsely demand bit equality across those conventions. Tap music uses the same decoder but has not received that separate FFmpeg check.

Other limits: host reciprocal-square-root/libm substitutes, partial PPC floating-point/exception semantics, omitted paired-single saves where scalar saves appear sufficient, Canvas/GX filtering and matrix precision differences, no TEV color-remapping effects. Exact original input polling phase and DSP-clock quantization are unqualified. Tap Trial's original wide projection is +/-416 x +/-228; its renderer was corrected from the golf prototype's assumed 854x480 coordinates. **Golf still has the older projection assumption; review it before claiming visual parity.**

## Inventory worth keeping

- `research/rhf-decomp/`: upstream recovered C++ source, headers, symbols, splits, bytecode scripts, original-data declarations, build configuration, baseline original objects, report and ELF. Upstream https://github.com/conhlee/rhf, commit `4429cbcb000abff644683d98701f6ab8c1671e10`. CC0 license retained.
- `research/original/main.dol`: original SOME01 executable, SHA1 **d96d2c7e50b0c713cb8fcb18835258351ada5576**. Same DOL is present in `research/rhf-decomp/orig/SOME01/sys/` for the decomp build.
- `research/golf/`, `research/tap/`: source asset metadata/banks, generated static translation, platform-adapter C, and detailed implementation notes.
- `tools/recompile-golf.py`: shared static translator. Default golf; `RHF_STANDALONE_GAME=tap` selects Tap Trial. The name is historical. New games need a new profile; unknown profile names are not currently safely validated, so do not merely set an arbitrary name and assume selection is correct.
- `tools/wii_files.py`: read-only encrypted Wii data-partition reader, FST, Yaz0 and U8 extraction. It currently gets the public Wii common-key data from one retained reference source file at `vendor/wasm-dolphin/vendor/dolphin/Source/Core/Core/IOS/IOSC.cpp`. This isolated file is included solely to keep the reader working; **no Dolphin runtime/build is included or required**. You may replace the reader's key lookup with an explicit equivalent public-data/config input and remove that reference later.
- `tools/extract-golf.py`: RGB5A3 TPL decoding, BRCAD animation/cell parsing, BRSAR group extraction. `extract-tap.py` reuses it.
- `tools/nintendo_audio.py`, `extract-golf-sfx.py`: RWAR/RWAV decoding and partial RSEQ tracing. `RHF_STANDALONE_GAME=tap` selects Tap samples. Other bank/instrument layouts/opcodes must be checked, not assumed supported.
- `tools/golf-timeline.py`, `tap-timeline.py`: trace selected original TickFlow scripts. They implement only the control-flow paths required by these levels; they are not a general game VM.
- `tools/test-*-runtime.mjs`, `test-*-timing.mjs`, each port's `qa/audio-check.mjs`: relevant behavior and audio checks.
- `evidence/`: decomp baseline, native PoC run logs, JSON measurements and screenshots. Some retained golf images precede the native PoC and show the original emulator reference. Treat only explicitly named standalone/native reports as PoC evidence.
- `MANIFEST.json`: paths, byte sizes and SHA256 for packaged files. `archive-verification.json` is supplied beside the ZIP in the originating workspace.

## What was intentionally left out

The ISO/ROM itself; 334 MB complete `rev_tengoku.brsar`; full Dolphin source/runtime/builds and browser emulator core/disc chunks/NAND/snapshots; 725 MB Emscripten SDK; Python site-packages; generated disassembly text that can be regenerated; unrelated evidence. The original per-level RWAR/RSEQ/RBNK slices and playable PCM/PNG/WASM files are included. Do not assume the missing full sound archive is a missing extraction failure: regenerate it from the separately supplied ROM when needed.

## New-machine setup — update these before rebuilding

These are working Mac scripts, **not a portable bootstrap**. The user explicitly prefers documenting needed changes over spending time polishing portability.

1. Use Python **3.12+** for upstream `configure.py` (the old macOS system Python 3.9 fails), Node 18+, Ninja, and Python packages from `requirements.txt`. A venv is recommended. `research/timing/inspect-original.py` inserts an old `research/python` path, but falls back to normal site packages; install Capstone normally.
2. `tools/build-golf.sh` / `build-tap.sh` invoke `/opt/homebrew/bin/python3` and `tools/emsdk/upstream/emscripten/emcc.py`. Install Emscripten **5.0.7** or point the scripts to a working equivalent SDK. SDK archive revision used originally: `6cd98e86d7749ff98b82b7f2ae78eb4f01942788`. Preserve `-O2 -flto -ffp-contract=off -fno-fast-math` and the exported heap methods. Do not enable fast-math to chase speed; scoring/rounding is sensitive.
3. `tools/emscripten-local.py` contains **absolute paths for the old workspace and Homebrew Node**. Rewrite LLVM_ROOT, BINARYEN_ROOT, NODE_JS, CACHE and PORTS for the new installation, or use that SDK's normal configuration and update the build wrapper. Original root was `/Users/britmob/Documents/rhythm-heaven-wasm`. Do not use it on another machine.
4. Decomp binaries in `research/rhf-decomp/build/tools`, `build/binutils` and `tools/decomp-bin/ninja` are **Mac binaries**. dtk and objdiff are arm64, binutils/Ninja are universal Mac, wibo is x86_64 Mac (Rosetta required on Apple Silicon). On Linux/Windows/other hosts, replace/move these before running upstream's downloader; do not accidentally execute the packaged Mac binaries. Retained Windows Metrowerks compiler versions are host-wrapper inputs, not Linux executables.
5. `tools/build-decomp.sh` accepts `RHF_DECOMP_PYTHON` for Python; defaults to the old Homebrew path. It passes explicit local tool paths. On another host install equivalents or let upstream configure/download its platform tools after moving incompatible packaged binaries aside. Versions: dtk v1.8.0, objdiff v3.5.1, wibo 1.0.0, sjiswrap v1.2.2, binutils 2.42-1, compiler archive 20251118. Only used compiler directories `Wii/1.0` and `GC/3.0a5.2` are bundled.
6. `tools/recompile-golf.py` and `decomp-diff.py` hardcode `research/rhf-decomp/build/binutils/powerpc-eabi-objdump`. Replace that path/tool as necessary. Use **`-M gekko`** for original disassembly: default binutils interprets paired-single bytes as unrelated VSX instructions. Capstone was insufficient for some floating-point/Gekko instructions.
7. `extract-tap.py` expects a ROM at the root named **`Rhythm Heaven Fever (USA).iso`**. Rename/symlink the separately supplied ROM or update that path. The reader expects a raw Wii ISO/data partition, not RVZ/WBFS. Preserve the original ROM read-only.
8. Shell executable modes may need `chmod +x start-*.sh tools/build-*.sh` depending on the unzip utility. No npm install is required to play.

Regenerate the omitted full sound archive after Python setup and providing the ROM at that root filename:

```sh
python3 - <<'PY'
import pathlib, sys
sys.path.insert(0, 'tools')
from wii_files import WiiFiles
root = pathlib.Path('.')
wii = WiiFiles(root / 'Rhythm Heaven Fever (USA).iso')
p = root / 'research/golf/assets/rev_tengoku.brsar'
p.parent.mkdir(parents=True, exist_ok=True)
p.write_bytes(wii.get('EN/content2/rev_tengoku.brsar'))
print('Extracted', p, p.stat().st_size)
PY
```

Tap's extraction creates a relative symlink to that golf sound archive. If symlinks are unavailable, update its source location or copy it locally. All native runtime files already present can be played/tested without this full archive.

## Reproduction checks

No compiler needed for these tests:

```sh
node tools/test-golf-timing.mjs
node tools/test-golf-runtime.mjs --auto
node tools/test-golf-runtime.mjs
node tools/test-tap-timing.mjs
node tools/test-tap-runtime.mjs --auto
node tools/test-tap-runtime.mjs
```

Expected: 33,000 golf / 16,500 Tap float32 classifier cases; 64/102 centered hits; no-input through counts 64/102. These compare the translated classifier to an independent transcription of recovered matching source, not to physical Wii execution. Strict expiration and finalized misses are checked. Late presses may hit subsequent notes in dense patterns; do not force every delayed event to become a miss.

After fixing SDK/tool paths:

```sh
python3 tools/recompile-golf.py
tools/build-golf.sh
RHF_STANDALONE_GAME=tap python3 tools/recompile-golf.py
tools/build-tap.sh
```

Regenerating native data with the supplied ROM/full BRSAR:

```sh
python3 tools/extract-golf.py
python3 tools/golf-timeline.py
python3 tools/extract-golf-sfx.py
python3 tools/extract-tap.py
python3 tools/tap-timeline.py
RHF_STANDALONE_GAME=tap python3 tools/extract-golf-sfx.py
```

Music decoding has no separate wrapper: use `wave_files`, `decode_wave`, `write_wav` in `nintendo_audio.py` on golf `wave-35.bin` or Tap `wave-131.bin`, write `music.wav` plus `music.json`. Use `verify=True` with FFmpeg installed for the independent decoder-convention check. Do not overwrite original waves or charts with approximations.

For readable matching decomp work, run the updated `tools/build-decomp.sh`. Existing report baseline is **13.33% exact code matched, 9.46% whole-unit linked code**, 1,602/8,142 matching functions; 868 split units. A byte-identical rebuilt DOL still uses original fallback objects and **does not mean 100% decompiled**. Local improvements include a matching TimeRatio parabola expression and fourteen matching golf scene callbacks. `LOCAL-WORK.md` records the older baseline; check fresh objdiff reports before claiming progress.

## How to add another game efficiently

1. Inventory `research/rhf-decomp/src/Game/` and `config/SOME01/{splits,symbols}.txt`. Prefer a small, well-recovered scene with a simple input channel, basic cell animation and few external services. Tap Trial was faster than golf because more of its source and script were recovered. Do not select by English display name alone: e.g. Hole in One is `Baseball` internally.
2. Locate the original main/practice script and game entry. Many scripts are already readable in `src/Game/Script/`. Identify exact start, music sound ID, full chart and end before results. Do not accidentally trace the tutorial or a remix.
3. Use `WiiFiles.files` / `get`, `u8_files`, `yaz0` to extract that scene's `EN/content2/cellanim/<internal>/ver*/cellanim.szs` and layout archives. Verify versions, asset headers and bounds. Keep provenance hashes.
4. Decode original TPL/BRCAD with existing functions where the formats match. RGB5A3 tiled 4x4 decoding is implemented; other texture formats need their own correct decoder. Cell object coordinates subtract 512, animation-key coordinates do not. Preserve child attachment/object transforms, layer ordering, flips, alpha, animation frame behavior and bank IDs assigned by the original scene.
5. Find the BRSAR sound/group/file IDs in `build_default/SOME01/include/rev_tengoku.rsid` and `SoundData.inc`. Extract RWSD/RWAR and RBNK/RSEQ groups; inspect rather than guessing. Some minigames use multiple tempo segments, sequences, streams, loops or different instruments. Tap music has 86/144-beat segments; golf has a single 200-beat segment. Map samples to beats piecewise.
6. Recover readable scene/flow/checker source when practical. As an interim bridge, add an explicit game profile to the translator selecting its three units plus shared helpers; write output to its own research/web directory. Preserve actual original addresses/vtables, r2/r13 bases, big-endian pointers and float operation order. New opcodes/ABI helpers must trap until understood; never broadly silence unknown calls.
7. Reuse the current platform adapter, but audit **every** external call. Golf has persistent ball/checker objects; Tap removes resolved checkers immediately. Input manager may apply an event to overlapping checkers. Holds/releases/A+B have not been implemented. Do not transplant golf assumptions without checking original routines.
8. Trace original chart control flow with explicit unsupported-op failures, or replace these per-game tracers with a validated general TickFlow runtime. Dynamic branches, tempo transforms, thread ordering and frame quantization can invalidate an offline static trace. Preserve the original `<0`/`>` and float32 boundary behavior.
9. Wire a minimal page and simple static start script. Validate visually in a browser, complete the entire level, exercise centered/early/late/missing/stray inputs, measure frame cost, and digitally inspect audio peaks/gaps. Test pause/resume, restarts, jumps and tempo transitions. Stop test audio afterward.
10. Compare against an independent original execution/audio reference before claiming 1:1. A platform adapter can change Perfect lifecycle, frame phase, score accounting or audio even when the core predicate is exact. Document unsupported paths; do not repair them by forcing outcomes.

## Important low-level facts already established

- PPC small-data bases: r2 `0x80328FE0`, r13 `0x80326EC0`. RAM adapter maps 32 MB starting at `0x80000000`; heaps/stacks use original pointer values inside that array.
- Original `CInputChecker::_20` is `0x801E7EB0`; lag is `(mTickPass - mTickJust) - inputAge`. Fields: elapsed +0x54, target +0x58, miss/Just/Just/miss +0x5C..0x68, lag +0x6C, finalized +0x71. A finalized miss returns without judging; changing a timestamp cannot recover committed callbacks/Perfect state.
- Golf target 48 ticks, Just monkey +/-6 and gorilla +/-5, outer +/-8. Tap target 48, Just +/-6, outer +/-10. Original adaptive narrowing can reduce to Just +/-1 / outer +/-4 after stray input. Do not replace this with a global fixed millisecond window.
- Original update order includes controller sampling, TickFlow/spawn, input dispatch, checker aging/expiry, scene update and cell animation. Native adapters approximate parts of the managers; independent phase validation is still required.
- Perfect uses eligibility, active/failed flags and a reason mask, not just a consecutive-hit count. Full original attempt lifecycle remains future work.
- CTRParabola's matching expression preserves original FMA/rounding order: `(mB*t)+((mA*t)*t+mY0)`. Reassociating this changed matching output.

## Recommended next priorities

First make the shared native runtime and asset pipeline easier to extend while preserving the two playable PoCs. Fix the provisional sound engine using recovered NW4R behavior and reference captures; qualify clock/input and original scoring/Perfect lifecycle. Correct golf's projection. Then add small game families using source recovery and/or explicit static profiles. Keep reports honest: source decomp progress, static recompilation coverage, adapter completeness and independently verified behavior are different measures.

**Suggested first message to the next agent:** “Read START_HERE.md, inspect the two native PoCs and the original decomp sources, fix only the environment paths needed here, run the included tests, then continue original-game extraction/decomp/native web port work. Ignore the old Dolphin browser-emulator project. Do not widen scoring windows or enable rollback. Work autonomously, verify in the browser, and keep automated audio out of my gameplay.”
