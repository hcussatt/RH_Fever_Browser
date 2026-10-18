# Hole in One standalone proof of concept

Playable at `http://127.0.0.1:8080/golf/` while the existing server runs. From a fresh terminal, `./start-golf.sh --open` serves the self-contained golf directory (chooses the next port if occupied). Space, X, canvas click, or standard gamepad button 0 swings. Escape pauses/resumes. Switching away pauses automatically. Restart reloads the level.

This is an experimental static recompilation, **not a completed readable decompilation or certified 1:1 port**. It runs independently of Dolphin: no ISO access, instruction-fetch interpreter, Wii hardware emulation, worker, WebGPU, or gameplay server. The existing full-game emulator is unchanged. Browser runtime files are entirely inside `vendor/wasm-dolphin/golf/`, approximately 23 MB.

## What executes

`tools/recompile-golf.py` translates 134 original PowerPC functions (27,444 instruction bytes) into fixed C control flow, built into a roughly 386 KB WASM module by `tools/build-golf.sh`. Original golf checker, scene, flow, pseudo-3D, shared input checker, animation and time-ratio functions execute with big-endian ABI memory and original read-only data. Unsupported instructions fail generation; unsupported platform calls trap. This bridge is not readable source recovery.

Reference executable: user-provided USA SOME01 DOL, SHA1 `d96d2c7e50b0c713cb8fcb18835258351ada5576`. Baseline symbols and matching shared source come from the local RHF decomp at commit `4429cbcb000abff644683d98701f6ab8c1671e10`. Source/disassembly remains under `research/rhf-decomp` and `research/original`; regeneration requires these local original files.

Textures, sprites, animation keys, musical chart, DSP-ADPCM samples, and short sound sequences are extracted from that disc. There is no manually authored substitute chart, shot trajectory, or judgment predicate in the playable implementation. The original full-level TickFlow chart, run by the shared chart player: 64 shots, 771 events, music 3,339,131 samples at 32 kHz / 200 beats, 104.34784375 seconds. The original post-music wait ends at tick 9696, about 105.3913 seconds. The prelude sets the original camera, poses, and clouds. Tutorial/prologue and original result UI are skipped.

## Timing and scoring

The original `CInputChecker::_20` at `0x801E7EB0` executes unchanged. Monkey Just windows are [-6,+6] ticks and gorilla [-5,+5]; both outer Miss windows are [-8,+8]. Endpoints are inclusive. The original stray-input narrowing, quality calculation, resolved flag, and strict late expiration are retained. Input age passed to the routine is zero: **no scoring timestamp correction, rollback, window widening, score forcing, or resurrection of finalized misses**.

Browser events enter the next fixed 60 Hz sampling frame. The simulation runs fixed frames against the Web Audio output timestamp, with an output/base-latency fallback; graphics can catch up while the already scheduled music continues. Event receipt time selects a future input sampling frame only. Historical checkers are never revisited. Presses already late at receipt remain late. Frame-phase equivalence to physical Wii polling and DSP sample quantization has **not** been established; exact boundary behavior in the classifier alone does not prove that end-to-end equivalence.

The platform adapter supplies the manager's A-trigger dispatch and fixed-frame update ordering. Golf uses A only; holds, releases, A+B, other games, and full controller-manager behavior are outside this PoC. The adapter follows recovered Perfect reason-mask / enabled / failed guards (default mask 7). Diagnostic failure state remains irreversible. It does not implement the full Perfect attempt lifecycle or original icons/failure jingle. Footer counts are diagnostics, not the original checkpoint grading/result screen or final numerical score.

## Audio

Music is decoded once from the original RWAV into PCM, then played by Web Audio. `tools/nintendo_audio.py` uses Nintendo's recovered rounded DSP predictor. An independent FFmpeg/GENH format cross-check confirms sample layout; FFmpeg's truncating predictor differs from Nintendo's rounding, so these are not falsely described as byte-identical decoders. Full original-hardware or native-Dolphin mixed-audio comparison remains outstanding.

All 58 golf samples are decoded, with 37 golf RSEQ entry points traced. The browser schedules fixed chart cues before playback; original gameplay callbacks trigger dependent sounds. No emulator audio FIFO or native/worklet queue is involved. Music gain .55 and SFX master .24 leave measured headroom.

**Sound parity limitations:** RSEQ random-variable branches are traced with midpoint values; some bend randomization is restored at playback. Browser envelopes/releases, volume curve, stereo panning, sweep handling and resampling are provisional. Tie/portamento/LFO/filter/effect-send behavior and ramps occurring after a note starts are not fully reproduced. This is original audio material through an incomplete mixer adapter, not a verified reproduction of NW4R/DSP output. Do not describe its sound as certified identical to Wii.

## Other adapter limits

- Canvas renders original cells, object attachments, layer order, alpha, flips, transforms and key changes. Matrix math/filtering differs from GX, color-remap TEV effects are not implemented, and layout-frame transitions are explicit stubs.
- Reciprocal square root / exponential / logarithm platform functions currently use host libm; original approximations are unqualified. This can alter visual trajectories at floating-point precision.
- Paired-single prologue/epilogue saves are omitted because the selected functions save/load scalar FPRs beside them and do not use PS1 computation. PPC exception/status, NaN payloads and out-of-range conversions are not fully modeled.
- Allocation, archive loading, layout registration, generic scene lifecycle, statistics and manager services are explicit adapters. Their omissions are visible in `recompiled/runtime.c`; unknown calls trap rather than silently continue.
- Desktop Chrome tested. Safari/Firefox compatibility is intended through ordinary WASM, Canvas2D and Web Audio, but not yet tested. No mobile work.

## Validation and reproducibility

```
tools/build-golf.sh
node tools/test-golf-timing.mjs
node tools/test-golf-runtime.mjs
node tools/test-golf-runtime.mjs --auto
node tools/test-golf-runtime.mjs --auto --offset=12
```

`evidence/golf-timing-tests.json`: 33,000 comparisons against an independent float32 transcription of the matching recovered classifier, including float neighbors at boundaries, both species, adaptive windows and finalized flags; strict expiration and failed late recovery assertions also pass. This is an independent predicate check, not an original-hardware oracle.

`evidence/golf-runtime-*.log`: complete original-chart runs. Center presses give 64 hits / zero misses / zero throughs / no Perfect failure. No input gives 64 throughs and failure. Inputs 12 ticks late give 64 throughs and 64 strays; no outcome is repaired. Early/late edge sweeps also exercise miss callbacks; fixed-frame phase influences their outcomes.

`evidence/golf-browser-full-run.json`: actual 104-second Chrome run, 64 scheduled presses, 64 hits, no errors or unknown sound IDs. 6,267 rendering callbacks: median .165 ms, p95 .320 ms, p99 .535 ms, max 2.685 ms for update plus draw. Browser reported base latency 5.33 ms and output latency 32 ms. **These are not measured click-to-photon or acoustic latency.**

The QA-only `qa/audio-check.mjs` renders the original full autoplay sound events through the same Web Audio adapter into 110 seconds of stereo 48 kHz PCM. Final corrected mix (`evidence/golf-final-audio-check.json`): peak .80187, RMS .10146, zero clipped or nonfinite samples, 377 sound events / 3,765 voices, no missing IDs. An earlier gain setting clipped five samples and was reduced. Offline output checks cannot detect physical device underruns, prove perceptual similarity, or establish Wii mixer equivalence.

Future work: replace provisional sound synthesis with recovered NW4R behavior; compare matched captures against native Dolphin/original hardware; validate tick/frame/input phase with an independent PPC execution reference; recover readable golf source; restore layout/Perfect/result UI; qualify PPC floating-point corner cases. Timestamp correction / rollback experiments remain **future use only**, documented separately in `research/timing/FUTURE-USE.md` and inactive here.

`evidence/golf-keyboard-and-pause.json`: four timed browser keydown/up presses alternating Space and X produced four hits. Receipt-to-simulation delays were 2.415, 6.845, 15.905 and 16.000 ms. Escape suspended the audio context and frame progression; resume continued successfully. The extended post-music run ended at simulation frame 6324. These are synthetic browser keyboard events, not physical switch-to-display measurements or gamepad qualification.
