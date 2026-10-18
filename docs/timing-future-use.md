# FUTURE USE ONLY — scoring correction / limited rollback research

**Inactive research. Not part of the playable browser game.** The user redirected work to vanilla latency optimization. Do not enable any timing correction without a new implementation and validation pass. No original judgment routine, timing window, score, or Perfect rule was patched during this experiment.

## Verified source facts

The local disc's extracted `research/original/main.dol` has SHA1 `d96d2c7e50b0c713cb8fcb18835258351ada5576`, matching the US SOME01 executable identified by the [RHF decompilation](https://github.com/conhlee/rhf), inspected at commit `4429cbcb000abff644683d98701f6ab8c1671e10`.

- `CInputChecker::_20`, original PPC address `0x801E7EB0`, calculates `mLag = (mTickPass - mTickJust) - inputAge`. The original comparisons and float rounding must stay authoritative.
- The lag is stored at `0x801E7EE8`; the checker fields include elapsed tick `+0x54`, target tick `+0x58`, four original window boundaries `+0x5C..+0x68`, lag `+0x6C`, and resolved flag `+0x71`.
- The function returns without judging if the resolved flag is set. `CInputChecker::_18` finalizes a miss after elapsed time exceeds target plus the late miss boundary; the manager can then remove the checker.
- `CInputCheckManager::fn_801E8BD0` matches events to checkers and calls the original hit/miss callbacks. Event age lives in a buffered input slot. Changing only the classification lag does not necessarily preserve note matching, adaptive wrong-input penalties, or event ordering.
- Tap Trial (`AgbTap`) is a possible first prototype: its decompiled flow creates a target at 48 ticks with boundaries -10, -6, +6, +10. These are **observed original values**, not permission to substitute a new scoring implementation.
- Tap Trial's miss and through callbacks call `CExScene::fn_80009ABC`, which reaches the original Perfect-failure machinery. A timestamp cannot by itself undo already committed callbacks, removed objects, counters, audio, or Perfect failure.
- A/B coalescing, cooldowns, releases, and hold handling must be studied independently. Preserve original frame quantization and float32 operation order, including exact boundary behavior.

## Future experiment outline — not implemented

1. Record browser event timestamps at receipt, preserving down/up order, button masks, and simultaneous inputs. A latest-mask mailbox alone loses quick transitions and does not supply a historical event stream.
2. Build a clock mapping from tagged source audio samples to game musical ticks, through native mixer buffering/resampling, the worklet queue, AudioContext playback time, and estimated output-device latency. A constant wall-clock subtraction is not sufficient evidence of exact musical alignment. Reset mapping across pauses, loads, sample discontinuities, and tempo changes.
3. Compare the original executable's judgments for undelayed input with corrected delayed input around every boundary. Include adjacent representable float values and all original adaptive-window modes. Test matching, score counters, callback effects, and actual Perfect outcomes, not just a rewritten predicate.
4. Before generalizing, deliberately deliver events after miss finalization. Timestamp-only correction cannot recover the current resolved/removed-checker path. Report this as unsupported rather than force a hit, reset Perfect eligibility, widen windows, or edit a score.
5. If revisited, a bounded **judgment-state** history or deferred-commit pipeline could be investigated separately from full-emulator rollback. It would need checker lifetime, input ordering, penalties, checkpoint counts, and Perfect state to be equivalent to original execution. Delayed visuals are acceptable, but changing the original outcome is not. No such design has been validated.
6. Full-emulator rollback would need a complete deterministic state plus reversible audio/GPU/persistence effects. It is not implemented or enabled; normal level-select snapshot loading is a startup convenience, not a runtime rollback system.

## Files and limitations

`inspect-original.py` disassembles locally extracted original instructions. `original-judge.py` is an **unvalidated, non-working research harness**: the installed Unicorn PPC backend crashes on memory mapping on this Mac before judgments execute. Do not cite it as scoring evidence. The decompilation is a research aid; original executable bytes and baseline game execution must settle discrepancies.

The playable build uses vanilla input and original scoring only. Relevant production paths link here as comments solely to preserve future context.
