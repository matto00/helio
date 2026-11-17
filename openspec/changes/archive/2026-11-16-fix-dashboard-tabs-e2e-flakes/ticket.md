# HEL-1644: HEL-1575 tab e2e flakes on main: dashboard-tabs :593 (~1 in 40) and :627 "logout clears the warm copy" (failed main CI at d777803c1)

## Description

Two intermittent failures in `e2e/hel1575-dashboard-tabs.spec.ts` that happen **on main**, not only on feature branches:

1. `:593` fails about 1 in 40 runs on both main and HEL-1573's branch. The cause isn't established. HEL-1573's
   evaluator first guessed a clock offset, and its skeptic's probe **disproved** that, so don't start from that theory.
2. `:627` **"logout clears the warm copy"** failed main's own CI at d777803c1 (HEL-1578's merge). It may relate to
   HEL-1634 (logout leaves some per-user caches in place), or to the warm-copy (IndexedDB) timing HEL-1575 fixed in its
   fix cycle 3.

Both are in the newest heavy spec, so they'll keep hitting every redesign lane's CI.

**Triage:** reproduce each with `--repeat-each` under the e2e lock, then get the root cause from a trace or probe
(systematic-debugging; no retries, no larger timeouts). Fix the test if it's a test race, or the app if it's a real
defect (for :627 that would be a user-visible privacy issue: data from the previous session surviving logout).

## Acceptance Criteria

- Each is shown failing first, then passes 40/40 (:593) and 40/40 (:627) after the fix.
- If either root cause is an app defect, there's a unit or seam test for it too.

## Notes (current tree, 2026-11-16)

- `:593` is now titled "an expired tab (16 minutes) refetches its panels" (still at line 593).
- `:627` is now at line 641, titled "logout clears the browser-stored warm copy".
- HEL-1681 (4f729eed7, merged after this ticket was filed) already fixed one race in the :593 test (server-clock
  offset re-measured after `clock.fastForward`). Whether the 1-in-40 flake survives that fix must be measured.
- There is no e2e flock lock in the repo (only a README mention). Concurrency is capped by Playwright workers=2 and
  `nice -n 19` instead.
