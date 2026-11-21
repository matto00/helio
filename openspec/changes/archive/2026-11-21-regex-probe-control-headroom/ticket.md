# HEL-1808: HEL-1683 regex long-task probe has little headroom on CI (74 ms control task vs 100 ms bound)

## Description

origin_kind: followup
origin_ticket: HEL-1697 (PR matto00/helio#1204, merged as 98b8c40e9). The owner chose to file this.

The existing HEL-1683 e2e long-task probe allows at most 100 ms for its control task. On one of HEL-1697's CI runs the
control task took 74 ms. On a slow CI host (see HEL-1793: older CPUs run about 1.4x slower), that becomes about 104 ms,
which is a likely future flake.

HEL-1697's own probe hit this once: dev-build rendering produced a 138 ms task, and the lane reshaped the frame rather
than raise the limit.

## Do

* Find what the control task's time is made of (rendering, the regex, the draft walk). Then reshape the frame so the
  evaluator's own work dominates and rendering noise does not.
* Do not raise the 100 ms limit. If that turns out to be the only fix, ask the owner.
* Record the task time across at least 5 CI runs, with each run's CPU model (from HEL-1789's runner record).

## Acceptance criteria

- [ ] The control task stays at or under 60 ms on the 5 recorded runs, or the PR states the remaining margin and its cause.
- [ ] The probe still fails on the pre-HEL-1683 code (mutation).

## Driver context (claims to verify)

- Evidence of the 74 ms: `.concertino/runs/HEL-1697/evidence/scratch/e2e2.log:1946` (CI run 44855147984, 2026-11-21T02:45Z).
  Archived control logs: 67 x 0.0 ms, one 58.0 ms, one 74.0 ms (a rare tail).
- Counting runs are this PR's CI runs; each costs a CI run, so use no more than 6 (AC + 1).
- e2e (+ test fixtures) only expected; no app code. Avoid HEL-1796 (backend patch-set undo) and HEL-1813
  (hel1790-hover-probe e2e) files.
