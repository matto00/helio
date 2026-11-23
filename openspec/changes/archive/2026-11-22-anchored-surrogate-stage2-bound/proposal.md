## Why

HEL-1807's staged anchored budget decision has one accepted-risk shape: a no-tail anchored frame at the budget whose
two-byte or astral cells each hold exactly one unpaired surrogate. Its stage-2 bound doubles the whole cell for that one
surrogate, so the bound misses and the exact per-character scan runs: 161 of 248 group-H calibration rows take 20-36 ms
(42.7 ms cold), against a 20 ms target. A tighter, still-sound bound removes the scan for that shape.

## What Changes

- The anchored stage-2 bound in `frontend/src/features/pipelines/evaluator/regexInputCost.ts` uses a cell's exact unit
  length (UTF-16 length plus one per unpaired surrogate, the same unit count `cellWork` charges) instead of doubling the
  cell when it has any unpaired surrogate.
- The calibration is re-run (HEL-1807's `calibrate-anchored.mjs`, groups A-H, carried into this change) and recorded in
  this change's `calibration.md`; the group-H rows are expected at or under 20 ms and are removed from accepted risk.
- A failing-first unit test pins the group-H worst shape's stage-2 bound to its exact charge (and the decision).

No decision changes: the bound stays a true upper bound of `cellWork`, so `workExceedsBudget` still returns exactly the
decision of the summed exact charge for every frame.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The `pipeline-client-evaluator` requirement (calibrated budget, 20 ms rule, accepted risk under 50 ms) already
describes the behaviour; only the recorded accepted-risk list shrinks. `skip_specs: true`.

## Impact

Frontend only: `regexInputCost.ts` and its tests; calibration evidence in this change. No migration, no backend, no API,
no parity-corpus change. `REGEX_WORK_BUDGET` stays 4.00e6.

## Non-goals

- The unanchored (HEL-1697) bound `cellWorkBound`, whose `unanchored (x)` group-H rows reach 25.2 ms (pre-existing,
  recorded by HEL-1807). Not changed here; a follow-up may be raised.
- Any cost-formula constant, the budget, or the anchored eligibility rule (D1 of HEL-1807).
