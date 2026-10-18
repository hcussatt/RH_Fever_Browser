# Tap Trial standalone PoC

Play http://127.0.0.1:8080/tap/ on the existing static server, or `./start-tap.sh --open`. Space / X / click / standard gamepad button 0 taps; Escape pauses. Switching away automatically pauses. Nothing runs on the server except static file serving. The directory `vendor/wasm-dolphin/tap` is self-contained (19 MB); no Dolphin or ISO is needed at runtime.

Built from the user's SOME01 disc, DOL SHA1 `d96d2c7e50b0c713cb8fcb18835258351ada5576`, using the same experimental static recompilation bridge as golf. 108 original functions / 16,840 instruction bytes become a 248 KB WASM module. Original Tap Trial scene, flow, checker, animation and trajectory functions execute; this is not a completed readable decompilation or certified 1:1 port.

Original assets: two sprite banks, two textures, stereo 32 kHz music (3,319,779 samples), ten sound samples and twelve RSEQ entries. Chart: 403 events / 102 taps. Tempo is mapped piecewise using original wave data: 86 beats in 1,310,479 samples, then 144 beats in 2,009,300 samples. Chart ends at tick 10848 (101.99891 seconds); the music tail finishes at 103.74309 seconds. Original tutorial, balloon text and grading/result UI are omitted. Footer counts are diagnostics, not the original grading score.

Original judgment routine remains unchanged: Just [-6,+6], outer Miss [-10,+10] ticks, inclusive boundaries, original stray narrowing and strict expiration. No score forcing, window widening, rollback or historical timestamp correction. Fixed 60 Hz button sampling uses the browser audio-output clock; physical Wii frame phase / DSP-clock quantization remain unqualified. Checkers are removed after judgment as the original manager requires. Dense patterns can let a late press hit a subsequent note; tests do not override that behavior.

Validation:

- `evidence/tap-timing-tests.json`: 16,500 float32 classifier comparisons, boundaries and adjacent floats, adaptive windows and finalized flags, strict expiration / no late resurrection checks.
- `evidence/tap-runtime-auto.log`: 102/102 hits, no misses or Perfect failure. No-input run: 102 throughs, failure. A run 24 ticks late produces 28 hits on later notes / 74 throughs and fails Perfect.
- `evidence/tap-browser-full-run.json`: complete desktop Chrome run, 102 hits, zero misses or runtime errors; update/draw p95 .145 ms, max .820 ms. No missing sound IDs.
- Same report: 110-second stereo 48 kHz offline audio render, peak .69546, RMS .10211, zero clipped/nonfinite samples, 313 sound events / 830 voices. This checks digital output, not physical device dropouts or perceptual parity.
- `evidence/tap-keyboard-check.json`: four timed synthetic browser key presses alternating Space and X produced four hits. Receipt-to-simulation delay 9.94–21.83 ms; this is not click-to-photon latency. Physical gamepad and Safari testing remain outstanding.

Audio uses the same mixer as golf: original note envelopes and volume rules (`docs/engine.md`, Audio). Resampling, effects and stereo behavior are not certified. Canvas follows the original widescreen projection (+/-416 x +/-228), with original sprite geometry; GX filtering, matrix precision and TEV effects remain unqualified. Host reciprocal-square-root approximation and platform/layout stubs retain the bridge limitations documented in `research/golf/RECOMPILATION.md`. Perfect failure guards are adapted, but full Perfect attempt UI/lifecycle is absent.

Reproduce:

```
python3 tools/extract-tap.py
RHF_STANDALONE_GAME=tap python3 tools/recompile-golf.py
RHF_STANDALONE_GAME=tap python3 tools/extract-golf-sfx.py
python3 tools/tap-timeline.py
tools/build-tap.sh
node tools/test-tap-timing.mjs
node tools/test-tap-runtime.mjs --auto
node tools/test-tap-runtime.mjs
```

Music PCM was decoded with `tools/nintendo_audio.py` from wave-131.bin. Original assets remain local. Timestamp-correction / rollback research is FUTURE USE ONLY and inactive; see `research/timing/FUTURE-USE.md`.
