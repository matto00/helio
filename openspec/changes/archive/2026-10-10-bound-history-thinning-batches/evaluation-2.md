## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `fec25bed5eeb1fd3e091d5b54c0401ff9749598f`, which sits on top of `4881d8e40` (the rebased cycle-1 commit).
Review base (resolved live): `df5c941e658d5dcb63656a671437bc037f29b3ed`. That is the current `origin/main`, and HEAD contains it.

### Gates (my own run on the rebased tree)

- `cd backend && nice -n 19 sbt -J-Xmx3g testFull` result: `Tests: succeeded 6655, failed 0, canceled 4` / `All tests passed.`
  - The output contains no `TESTS FAILED` or `*** FAILED`.
  - The 4 canceled tests are the existing `HELIO_MEASURE` report-only specs.
  - `EmbeddedPostgresStartGuardSpec` ran and passed.
  - The new mid-pass lock test ran and passed.
  - No "outer reference" compiler warnings remain.
  - `sbt shutdown` was run afterwards.
- `check:scala-quality`: clean (soft warnings only).
- `check:openspec`: clean.
- Prettier on CLAUDE.md and the change's markdown: clean.
- The Docker measurements were not re-run, as instructed. One check below is computed from their committed raw logs.

### Cycle-1 change requests: status

1. **Evidence committed: DONE.** 252 evidence files are tracked. `git status --ignored` shows nothing ignored under `evidence/`.
2. **Rebased onto main, `VerifiedEmbeddedPostgres`: DONE.**
   - `OutputHistoryBatchedThinSpec.scala:37` now starts embedded Postgres through `VerifiedEmbeddedPostgres.start(...)`.
   - The guard spec passes.
3. **Lock taken part-way through ONE pass: DONE, and the test is real.**
   - A `DbContext` subclass takes the shared lock after the first batch transaction completes. This is deterministic: the lock is taken inside the `map` that the loop's `flatMap` depends on.
   - The test asserts:
     - the outcome is `LockHeld(d > 0, Some(cursor))`;
     - `d` equals the rows removed by batch 1;
     - batch 1 matches the oracle;
     - the remaining Outputs are untouched;
     - a retry from the cursor leaves a freshly inserted thinnable pair in a batch-1 Output alone;
     - a full drain then removes that pair, so the pair really was thinnable.
   - The red is behavioural. `red-mid-pass-lock-mutation.log` shows `0 was not greater than 0 (OutputHistoryBatchedThinSpec.scala:220)` under the `LockHeld(0, startAfter)` mutation, and `green-mid-pass-lock.log` shows the passing run.
4. **Max-batches rationale: the decision is corrected, but the stated numbers are not supported by the evidence.** See Phase 1.
5. **Code fixes: DONE.**
   - `BatchResult` moved to the companion object.
   - `nextDue` scaladoc restored.
   - `thinned` typo fixed.
   - `thinAndPurge` marked TEST-ONLY.
   - Stale doc references now point at `thinPass`.
   - tasks.md 2.1 reworded. A comment now explains why the `""` cursor is unreachable.

### Phase 1: Spec Review — FAIL

- Acceptance criteria 1–4, the spec scenarios (including the mid-pass lock), tasks, and constraints C1–C5 are all met, as covered in cycle 1 and above.
- **A documented stall bound is contradicted by the committed per-transaction evidence.**
  - What the docs claim:
    - CLAUDE.md:82 says the `OUTPUT_HISTORY_THIN_MAX_BATCHES_PER_PASS` row stalls the tick "20-49 s per deep-backlog pass" on the prod-class proxy.
    - `measurements.md:308-309` says "20-49 s (`prod-io-base`)" and "the worst measured stall of the tick is under half the old tick's".
  - How those figures were derived: the *average* per-batch cost of the M=60 passes, multiplied by 20.
  - What the per-transaction log shows: the committed one-batch-per-pass drain, `evidence/drain-new-M1-S4-prod-io-base-R25000.log` (300 `@@PASS ... ms=` lines, one per batch transaction), contains the real batch costs. The 20-batch passes the shipped default actually forms (aligned from the cycle start) reach **91.6 s**. Any 20 consecutive batches reach **96.7 s**.
  - Comparison: the old tick on the same data is 109.6 s. So the worst M=20 stall is about 84–88% of the old tick, not under half.
  - Other scenarios check out:
    - Desktop S4: 18.4 s, above the claimed 4–12 s.
    - S2 prod-io-base: 5.6 s, against the claimed "about 3 s".
  - The choice of M=20 itself still holds: it stays below the old tick on both data sets. The published figures understate the worst case by about 2x.

### Phase 2: Code Review — PASS

- The cycle-2 code diff is small and correct: the default changes 60 → 20, `BatchResult` moves to the companion, plus the doc fixes and the new test.
- No new issues found.
- The test's lock holder is closed in `finally`.

### Phase 3: UI Review — N/A

This is a backend-only change.

### Overall: FAIL

### Change Requests

1. **Replace the derived pass-stall figures with the measured worst case, in both places.**
   - Compute the worst 20-batch window from the per-transaction drains, `drain-new-M1-<S>-<profile>-R25000.log`. From my computation, using the `ms=` field:
     - S4 prod-io-base: aligned 91.6 s, worst window 96.7 s.
     - S4 desktop: 18.4 s.
     - S2 prod-io-base: 5.6 s.
     - Recompute S3 the same way.
   - In `measurements.md:303-310`:
     - Say these figures come from the per-transaction drains, not from M=60 averages.
     - Replace "under half the old tick's" with the real ratio (about 0.85x the old tick of 109.6 s on S4 prod-io-base).
     - If you keep the M=60-derived 20–49 s range, label it as an average.
   - In CLAUDE.md:82, change "about 3 s per steady-state pass ... 20-49 s per deep-backlog pass" to the measured worst cases (e.g. "up to about 6 s steady state and up to about 97 s deep backlog, versus 81-110 s for the old single tick").
   - No code change is needed; M=20 still satisfies the "at or below the old tick" bound.

### Non-blocking Suggestions

- measurements.md section 10 already names the stronger design: a per-pass wall-clock budget, or running the thin off the scheduler tick. That is worth a follow-up ticket, because under the cold strict IO model even M=1 stalls the tick for minutes.
