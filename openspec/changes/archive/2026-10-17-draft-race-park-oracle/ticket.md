# HEL-1654: DraftSaveDeadlockSpec fails intermittently on CI ("writer COMMITTED while the save was parked"): root-cause whether HEL-1629's lock protocol has a real gap

## Description

HEL-1629 (PR #1054, 544bd79ea, on main) added `com.helio.api.routes.pipelines.DraftSaveDeadlockSpec`. On PR #1055 (HEL-1584, zero backend diff), CI run 39065904736 failed backend (1) on two of three attempts:

- Attempt 1: "should not deadlock: the save locks the alert rules before the Outputs, the order the evaluator's FK checks take them" — `protected: RaceOutcome(SaveFirst, save=200, writer=ok, violation=true, deadlock=false, blockedObserved=false)`; trace: `save (backend 57141) PARKED past its compare` / `writer COMMITTED while the save was parked` (DraftSaveDeadlockSpec.scala:34).
- Attempt 2: the same case, plus "should deadlock when the delete holds the Output and cascades into rules the save already holds" — `control: RaceOutcome(SaveFirst, save=PatchSetStale(...), writer=ok, violation=false, deadlock=false, blockedObserved=false)`, same trace.
- Attempt 3 passed (2063 tests, 0 failed). Main's own push CI (run 39032828048) passed once.

Key signal: `blockedObserved=false` in both — the writer never blocked on the save's locks. Either (a) a real gap in the §8.3.1 protocol (data_sources → lockForDeletion → cycle advisory → pipeline row FOR NO KEY UPDATE via V137 `hel1629_lock_pipelines` → alert rules by id → Outputs by (position, id)), a lost-update/consistency bug on main; or (b) a test-oracle race in the harness's "parked" detection.

HEL-1631 builds on this save path, so this must be settled first.

## Do

- Systematic debugging; no fix without a probe-confirmed cause. Reproduce under CI-like conditions (CPU-limited/loaded, `HEL924_TEST_GROUP_CONCURRENCY=2`, the CI JVM heap, many repetitions). Capture `pg_locks` / `pg_stat_activity` / `pg_blocking_pids` at the "parked" point and at the writer's commit.
- If (a): escalate to the owner with evidence and options BEFORE fixing (it may change the lock protocol); then fix with a red-first spec, re-verify G1–G3, update §8.3.1, assess prod impact.
- If (b): make the oracle deterministic by synchronising on observed lock/wait state, not sleeps. Prove it fails when the lock is removed (existing mutations SK1/SK3/SK5/M7 and the rest) and passes 50/50 under load.
- Check sibling race specs sharing `DraftRaceFixture` for the same weakness and fix them the same way.
- Confirm v0.9.8 (cut from 29cb0a60f) contains none of HEL-1629's code or V137.

## Acceptance Criteria

- The root cause is stated with evidence (pg_locks traces at the parked point and at the writer's commit).
- The spec passes 50/50 under CI-like load, and every lock-removal mutation still turns it red.
- Sibling specs using the same fixture are checked and, if they share the weakness, fixed the same way.
- If the protocol changed, the race and RLS suites are re-run and §8.3.1 is updated.
- Release exposure of HEL-1629 / V137 stated (v0.9.8 does not contain it).
