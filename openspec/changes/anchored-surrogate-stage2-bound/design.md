## Context

See proposal.md - Why. `workExceedsBudget` (`frontend/src/features/pipelines/evaluator/regexInputCost.ts`) decides in
three stages for an anchored pattern: stage 1 `cellWorkBound` (anchored: `L = 2 x text.length`, no per-cell test),
stage 2 `testedBound` (`L = 2 x text.length` if `LONE_SURROGATE.test(text)`, else `text.length`), stage 3 the exact
`cellWork` scan (`codePointAt` + `inRanges` binary search per code point). Each stage only skips stage 3 when its sum is
within the budget, so the decision always equals "sum of `cellWork` > `REGEX_WORK_BUDGET`".

`cellWork` counts units per code point: a surrogate pair 2, an unpaired surrogate `LONE_SURROGATE_UNITS = 2`, anything
else 1. So a cell's exact unit length is `text.length + (number of unpaired surrogates)`. Stage 2 over-states it by
`text.length - loneCount`; on a cell with one lone surrogate that is ~2x, the bound misses, and stage 3 reads every
character. Group H of HEL-1807's calibration measured this at 20-36 ms (decision ~17-22 ms + exec ~11-14 ms).

## Goals / Non-Goals

**Goals:** stage 2 uses the exact unit length; the group-H shape is admitted without the stage-3 scan and measures under
20 ms (decision + exec); every calibration frame decides exactly as before; no frame's decision gets slower by more than
noise (in particular cells dense in unpaired surrogates).

**Non-Goals:** the unanchored path (`cellWorkBound` non-anchored branch, `perPositionWork`), stage 1, the cost formula
and its constants, `REGEX_WORK_BUDGET`, anchored eligibility, the parity corpus.

## Decisions

**D1 - Stage-2 unit length is `text.length + loneCount(text)`.** `loneCount` counts UTF-16 code units in
`U+D800-U+DFFF` that are not part of a valid high-low pair (exactly the code points `cellWork` charges
`LONE_SURROGATE_UNITS` for). With `LONE_SURROGATE_UNITS = 2` this is `L = sum of cellWork's units` exactly, so:
`A x len <= A x L`; every run term is monotone and runs sum to at most `L`; the anchored attempt
`A x (1 + W) + R0 x (A + m)` has `R0 <= L`. Hence `boundAt(work, L) >= cellWork(text, work)` (a true upper bound) and
the decision is unchanged for every frame. Write `L` as `text.length + (LONE_SURROGATE_UNITS - 1) x loneCount` so the
identity survives a change of the constant. When the first run covers the whole cell and the pattern has no tail, the
bound equals the exact charge, so the group-H frame is admitted at stage 2.
Alternative rejected: keep doubling and speed up stage 3 (`inRanges` is already a binary search; the scan is the cost).
Alternative rejected: a looser fixed allowance ("+1 per cell"): unsound for cells with several unpaired surrogates.

**D2 - Counting must stay native and cheap for every density.** Keep `LONE_SURROGATE.test(text)` as the gate (cells
without an unpaired surrogate keep `L = text.length`, today's path). Only when it matches, count. The counting method is
chosen by measurement, not assumed: candidates are `text.length - text.replace(LONE_SURROGATE_G, "").length` (one native
pass), a global/sticky `exec` loop (per-match JS overhead; risky on dense cells), and a `charCodeAt` loop. The chosen
method must be measured on (a) group H (one lone surrogate per cell) and (b) dense cells (2, 16, half and all code units
unpaired surrogates) on the wide classes at the budget, recorded in this change's `calibration.md`; the dense rows must
not be slower than on main by more than noise (on main, stage 2 already hits for an all-lone cell, since `2 x len` is
exact there). If no method keeps both (a) under 20 ms and (b) no worse than main, escalate rather than ship a regression.

**D3 - Failing-first test, deterministic, no timing assertion.** Add to the existing jest specs
(`regexInputCost.test.ts` / `regexCellWork.test.ts`) a test on the group-H worst shape (`^([^<64 ranges>]*)`, CJK
cells + one trailing `\ud800`, 1,000 x 1,997, compiled with `compileJavaRegex`) that fails on main: either the stage-2
bound equals the exact `cellWork` charge (export the stage-2 bound function under a test-visible name, or test it through
an observable seam), or the decision reads no code point (`String.prototype.codePointAt` spy shows zero calls). Plus the
decision is `false` (client-side), and a soundness property test over generated cells mixing pairs, lone highs/lows at
any position and density: stage-2 bound `>= cellWork` and `workExceedsBudget === (sum cellWork > budget)`. Red run is
committed (or recorded as `.txt` evidence if the hook refuses a red commit) before implementation. Mutations (e.g. drop
the `- 1`, count pairs as lone, revert to doubling, count only the first lone) must each turn a test red; recorded.

**D4 - Calibration re-run.** Copy `calibrate-anchored.mjs` from the HEL-1807 archive into this change dir (it finds the
repo root by ancestor and transpiles the worktree's shipped modules), add a dense-surrogate group (D2 b) to it, and run
groups A-H plus the new group, one per Bash call (each under 10 min, `nice -n 19`), output under the main checkout's
`.concertino/scratch/HEL-1823/`. Record in `calibration.md`: per-group max, the group-H before/after table, the new
group, and a decision-identity check: every row's decision (and cost) matches HEL-1807's recorded tables, and no
`MISMATCH` line. HEL-1697 shapes: the unanchored path is unchanged code, and groups A-D carry the anchored forms of every
HEL-1697 pattern; state this in `calibration.md`.

**D5 - e2e.** `e2e/hel1683-regex-main-thread.spec.ts` (the long-task checks; HEL-1816 moved them to the `@prod-build`
project, `npm run e2e:prod-build`) run in full and pass; transcript saved as evidence.

## Risks / Trade-offs

- [Counting on dense cells regresses the decision] -> D2 (b) measurement and the escalate-rather-than-ship rule.
- [Bound becomes unsound by a miscount] -> D3 property test + mutations; decision identity checked on all calibration rows.
- [Timing noise on a desktop shared by other lanes] -> best-of-N as HEL-1807, `nice -n 19`, rerun a group once if noisy.

## Planner Notes

- Self-approved: no spec delta (`skip_specs: true`) - the requirement text (20 ms rule, accepted risk under 50 ms) is
  unchanged; only the recorded accepted-risk list shrinks.
- Self-approved: the unanchored `(x)` group-H rows (25.2 ms, pre-existing HEL-1697 behaviour) stay out of scope; the
  lane may raise a follow-up triage.
- The HEL-1807 archived `calibration.md` is history and is not edited; this change carries its own.
- Design-gate round 1 (CONFIRM) notes adopted for D3: use the existing `countReads` zero-reads seam
  (`regexInputCost.test.ts`) for the red test rather than a new export; also run it on an astral body (`\u{1F600}` x n +
  one lone surrogate) so a "count pairs as lone" mutation turns red; the property test uses patterns whose class contains
  surrogates (`^(.+)`, `^(.*)x`, a negated class); size the frame from `cellWork` so the exact sum is exactly 4.000e6, and
  assert one more character is declined.
