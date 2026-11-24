## Why

The client draft preview decides whether an accepted regex may run on the main thread by `workExceedsBudget`
(`frontend/src/features/pipelines/evaluator/regexInputCost.ts`). For an unanchored pattern it sums the closed-form
`cellWorkBound` and, when that exceeds `REGEX_WORK_BUDGET`, runs the exact per-character `cellWork` scan
(`perPositionWork`: `codePointAt` plus a binary search `inRanges` per code point). For W=1/m=0 patterns such as `(x)` the
bound is `2L` against an exact `L` on cells without a match character, so every frame whose exact charge is in
(2e6, 4e6] is scanned. Premise validation measured that scan at 21-27 ms on two-byte cells (worst row 28.8 ms with a lone
surrogate, 25.6-28.2 ms without one), over the 20 ms target. The ticket's proposed exact-length rule cannot remove it
(premise-validation.md); the scan itself is the cost.

## What Changes

- The unanchored exact scan (`perPositionWork`) tests class membership of BMP code units through a 64K `Uint8Array`
  membership table built once per `chars` set (cached), reading with `charCodeAt`; only an astral code point (a valid
  surrogate pair) still uses `inRanges`. The charge it returns is identical to today's for every string.
- A length-only pre-check skips stage 1's per-cell surrogate test when its sum already exceeds the budget (stage 1
  could not avoid the scan then); and stage 1 uses the exact unit length (`unitLength`) instead of doubling, kept only if
  measured not slower. Both keep the bound a true upper bound and the decision unchanged (design D2/D3).
- The calibration (`calibrate-anchored.mjs` from the HEL-1823 archive, carried into this change) gains group J: the
  surrogate-free cyr `(x)` shape and the loosest unanchored shapes (wide classes on bodies of their own non-members,
  up to about 46 ms on main and recorded nowhere), and is re-run for groups A-I plus J.
- A failing-first test on the worst unanchored `(x)` row.

No decision changes and no cost changes: `cellWork`'s result is unchanged for every input.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The `pipeline-client-evaluator` requirement (calibrated budget, 20 ms rule, accepted risk under 50 ms) already
describes the behaviour; only the recorded accepted-risk list shrinks. `skip_specs: true`.

## Impact

Frontend only: `regexInputCost.ts` and its tests; calibration evidence in this change. No backend, no migration, no API,
no parity-corpus change. `REGEX_WORK_BUDGET` stays 4.00e6.

## Non-goals

- The group-D `(.{16})x` control (an exec-only V8 timing on a 9x-budget frame, 19.0-21.4 ms run to run): reported, not
  chased; its only lever is its cost constants, which may not rise.
- The anchored path (HEL-1807/HEL-1823), the cost formula and its constants, the budget, the parity corpus.
