# Local continuation

Upstream: https://github.com/conhlee/rhf at `4429cbcb000abff644683d98701f6ab8c1671e10`, checked against GitHub on 2026-10-18. Preserve upstream CC0 license and attribution. Game assets and the original DOL remain local inputs.

The first local milestone is a reproducible, byte-identical Wii build plus an objdiff baseline. This has been achieved using the user's DOL, SHA1 `d96d2c7e50b0c713cb8fcb18835258351ada5576`. The build combines compiled source with original fallback objects. Its matching hash does **not** mean the entire game has been decompiled.

From the workspace root, run `sh tools/build-decomp.sh`. It uses workspace-local Ninja, dtk 1.8.0, objdiff 3.5.1, wibo 1.0.0, sjiswrap 1.2.2, binutils 2.42-1, and compiler archive 20251118. The upstream generator requires Python 3.12+; the system `/usr/bin/python3` is too old. Override the local Homebrew Python path with `RHF_DECOMP_PYTHON` if needed. This wrapper currently assumes the already-provisioned local toolchain; it is not a portable bootstrap installer.

Baseline report: `build/SOME01/report.json`. Workspace summary: `../../evidence/decomp-baseline-summary.json`. All existing source units compiled. The generated split contains 868 units, including 126 automatic gap/data units; the configuration explicitly lists 742 units. These counts describe build structure, not source quality.

| Category | Exact matched code bytes | Whole-unit linked code |
| --- | ---: | ---: |
| Overall | 13.33% | 9.46% |
| Game | 9.52% | 4.83% |
| Game utilities | 86.49% | 60.66% |
| Wii SDK | 7.17% | 6.98% |
| NW4R | 14.97% | 13.58% |
| Runtime | 80.04% | 31.11% |
| MSL / MetroTRK / Mii library | 0% | 0% |

The default report uses upstream relocation comparison settings; it is a baseline, not independent proof of behavior or all data/relocation fidelity. There are 1,602 reported matching functions out of 8,142. The remaining 6,540 include absent code, partial code, and functions that may need symbol identification or compiler matching rather than new reconstruction. File presence alone is not coverage.

## Remaining work

1. Recover and match the missing game scenes, per-game flow scripts and checkers, title/selection/cafe/menu systems, multiplayer, toys, endless games, and ancillary UI. Of 268 configured Game units, 195 have no corresponding source file. Source-present units can also remain partial or nonmatching.
2. Finish the shared script VM, timing/rate transformations, input manager, checkpoint/Perfect logic, animation/layout code, and save handling. InputChecker itself already reports all 24 functions exactly matching; it is not yet approved as a fully linked unit. Preserve original float operations, update ordering, input-edge semantics, and judgment boundaries.
3. Recover missing Nintendo runtime/library code for a full Wii matching decompilation. Some low-level SDK functions are naturally assembly; source assembly there is not automatically unfinished work. A browser port may instead replace platform-specific facilities, but those replacements are a separate deliverable from a full matching decompilation.
4. Recover and verify data tables, vtables, relocations, asset references, and remaining unidentified symbols. Code-only percentages do not qualify these. Preserve original assets; do not approximate level scripts or audio.
5. After source recovery, add a browser platform implementation: OS/thread/timer services, file/NAND access, controller polling, GX rendering, NW4R sequence/wave/stream playback, and resource loading. Explicitly handle PowerPC byte order, 32-bit pointers/ABI assumptions, paired-single/assembly operations, and floating-point behavior. A matching PowerPC build does not compile unchanged to WASM.
6. Validate original behavior using matched input traces, judgment/Perfect outcomes, frame/event traces, original assets, and native/reference audio. Repeat across taps, A+B, holds, releases, practice, pause, results, saves, and all game variations.

## Working order

Keep the existing browser emulator runnable while continuation work proceeds here. First focus on the nearly recovered utility layer and an already well-recovered minigame (AgbTap/Tap Trial) to establish source-level behavior checks. Then expand game families and libraries. Do not count generated C-like pseudocode, stubs, or original-object fallbacks as finished source. Do not mark objects matching merely to improve progress figures.

Completing the decompilation and building the native browser runtime are substantial research/engineering tracks. Neither is completed by the baseline build, and neither automatically repairs the existing emulator's audio pipeline.
