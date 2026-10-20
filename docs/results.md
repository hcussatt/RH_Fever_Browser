# Original grading and results

The standalone ports now run the USA game's original checkpoint manager and
results/epilogue charts. The browser no longer replaces results with a hit-count
overlay. This applies to all eight registered web games, including Remix 1, in free play.

## Source of behavior

`tools/recompile.py` includes `GameUtil/CheckPointManager.cpp` and
`Game/Grading/MyFlow.cpp` from the original DOL, alongside the original TickFlow
interpreter. The original instructions execute in WASM. `platform.c` supplies
message lookup, browser input, sound requests, and scene changes.

Checkpoint commands install the chart's original criteria, select the current
category, enable/disable scoring, and set forgiven through counts and the
through-grouping interval. Hit/miss callbacks reach the original manager. Its
frame update controls grouping. `fn_801EB130` computes grades and selects
comments; JavaScript never chooses thresholds or upgrades a result. Diagnostic
hit counts remain separate: they deliberately include events that grading may
forgive or group. Original input timing classifiers and Perfect guards remain
in place; no timing windows were widened and rollback remains inactive.

The parent game chart continues after its end marker. It performs the original
fade, calculates grading, and calls `lbl_801F97E0`. The original Grading MyFlow
requests heading, comments, grade, and optional follow-up at their original
rests. Result music, confirmation effects, and the subsequent epilogue chart
(`lbl_801F96A8`) follow the original commands. Browser A is Space, X, click, or
gamepad A. Confirmation waits for a press **and release**; held input does not
skip either screen. The original five-frame Next exit animation gates the
transition. Completion returns to the existing browser library.

`tools/extract-results.py` converts the original grading BRLYT/BRLAN, TPLs,
font glyphs, comment BMG, per-game epilogue cell animations and layout, permanent
A/Next graphics, and six result/epilogue RWAVs. Everything disc-derived stays
under ignored `build/` and `dist/` and is generated during local ISO import as
well. The two-texture rotating star mask, visibility keys, single-frame caption
window, and glyph-atlas gutters are handled by the shared layout renderer.

The chart's end command, not the WAV file's duration, hands control to results.
This matters for Tap Trial's longer audio tail. Music/scene voices are stopped
at the original heap-reset commands; permanent system sounds are retained.
Scheduling a later reset cannot postpone a source's already scheduled stop.

One recovered header labels epilogue opcode `0x107` arguments incorrectly.
The original executable calls `fn_8000B398`, `fn_8000B3D4`, and `fn_8000B410`
for arguments 0, 1, and 2: **Superb, OK, Try Again**, respectively. The extractor
uses the executable's order, not that header's comments.

## Validation

Run after building:

```sh
node tests/test-grading.mjs
node tests/test-golf-timing.mjs
node tests/test-tap-timing.mjs
```

The grading test compares original WASM predicates against an independent
threshold oracle across 307,440 integer/percentage boundary cases. It also
plays each full game with no input and with centered input, then runs both
results confirmations and the epilogue through completion. It checks the
original 90-frame heading-to-comments and 135-frame comments-to-grade rests,
selected music IDs, original comments, and Perfect outcomes. `build.sh` runs
this test along with the existing timing and complete-level tests.
Additional fixtures cover mixed-category But/follow decisions, forgiven
throughs, grouping immediately inside and exactly at 60 ticks, disabled scoring,
and held confirmation input.

For a silent browser/audio check from a built game page:

```js
const {checkResults} = await import('../engine/qa/results-check.mjs');
await checkResults(new URL('./', location.href), {mode: 'centered'});
```

Modes are `centered`, `none`, `ok`, `but`, and `follow`. The last three are
repeatable **input patterns for Hole in One**, not score overrides. `follow`
presses only category 1 cues. All scoring still runs through the original
checkers. The function renders audio with OfflineAudioContext, never speakers,
and rejects clipping, non-finite output, missing sounds, and broken transitions.

Chrome checks exercised Try Again, OK, the But variant, Superb, the positive
follow-up, and the three-comment Love Rap layout. The normal page's Play,
Escape pause/resume, X confirmation, Space confirmation, and return to the
library were exercised with its output gain muted. Hole in One's five offline
branches had no missing sounds, no clipped/non-finite samples, and digital peak
amplitudes between 0.332 and 0.339 before the newer shared output-gain adjustment
(and 0.289 to 0.299 across all nine merged result branches afterward). These are digital-output checks, not acoustic
measurements.

## Fidelity limits and future work

The original grading logic, criteria, comments, art, font, and chart order are
used directly. **100% pixel/audio parity with Wii hardware has not been
established**: there is no captured Wii framebuffer/audio reference comparison.
Canvas filtering/rounding and Web Audio resampling, pan, LFO, and filters still
have the shared engine's limitations. Disc asset reuse and threshold tests
alone do not prove hardware-identical presentation.

This is the project's unlocked free-play context. It does not write Wii save
progression, award a new medal, run the menu's Perfect-campaign celebration,
or present two-player results. The original medal pane is retained but hidden
in this context. Adding progression later needs the original save/previous
level-state checks before enabling that pane; do not simply display a medal
for every Superb. The newer generic material renderer supports texture stages and colour animation,
but the medal/progression presentation still needs qualification before enabling it. Missing unrelated Wii scene-loading waits are represented by
ready assets, rather than reproducing variable disc I/O time.
