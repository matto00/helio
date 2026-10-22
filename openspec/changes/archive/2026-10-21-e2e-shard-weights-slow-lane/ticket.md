# HEL-1667: CI e2e headroom: regenerate shard weights from CI artifacts and add a slow/nightly lane for HELIO_E2E_SLOW sweeps

## Description

origin_kind: followup
origin_ticket: HEL-1582 (PR matto00/helio#1060), HEL-1642 (PR matto00/helio#1062)

The e2e legs on main took 11–16 minutes against the 18-minute `timeout-minutes` (CI runs 39105908594 and 39104389051).

* HEL-1642's leg 4 was cancelled 6 s over the limit, in post-run cleanup, with every test passed.
* HEL-1582 couldn't fit at all. Owner rulings:
  * gate the 390/768 maximal phone sweeps behind `HELIO_E2E_SLOW=1`;
  * raise the e2e job timeout to 25 minutes, in PR matto00/helio#1060.

What's left:

1. **Shard weights.** The four `hel1582-*` spec files and other v0.9 specs have no rows in `e2e/shard-weights.tsv`, so each defaults to 35 s and the legs can't balance. Regenerate the weights with the documented `node scripts/e2e-shard.mjs weights` from a complete, uncancelled CI run's JSON artifacts. Don't hand-edit.
2. **Slow lane.** The `HELIO_E2E_SLOW=1` sweeps currently run only locally, before merge. Add a scheduled (nightly) or manually triggered workflow that runs them, so they keep running after HEL-1582 merges.

## Acceptance Criteria

* After the weights are regenerated, the slowest leg on main is within 2 minutes of the fastest.
* The slow lane runs on a schedule and runs the gated sweeps. Evidence: one green run on main.

## Driver notes (claims, verified in premise-validation.md)

* Overnight mode: escalate CI-cost decisions (slow-lane schedule) with a recommendation before building.
* Ticket comments could not be read in this session (no comment-list tool, no LINEAR_API_KEY).
