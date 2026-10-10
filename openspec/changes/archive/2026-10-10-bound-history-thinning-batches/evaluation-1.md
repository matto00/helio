## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `e2cc10b997974aab34d29336e4a6517c887561d4` (branch `task/bounded-history-thinning-batches/HEL-1435`).
Review base (live-resolved): `22f4c1fd326b491337a91e46131fb573cc99774d`.

### Gates (evaluator's own run)

- `cd backend && nice -n 19 sbt -J-Xmx3g testFull`: `Tests: succeeded 6539, failed 0, canceled 4` and `All tests passed.`
  No `TESTS FAILED` / `*** FAILED` in the output. The 4 cancels are the existing `HELIO_MEASURE` report-only specs.
  `OutputHistoryBatchedThinSpec` (4 tests), the new `OutputHistoryRetentionServiceSpec` continuation cases, and
  `RetentionLockGuardSpec` REVERSE all ran and passed. Ran `sbt shutdown` afterwards.
- `npm run check:scala-quality`: clean (soft size warnings only). `check:openspec`: clean. Prettier on the changed markdown: clean.
- Not re-run: the Docker measurements (per orchestrator instruction). I reviewed their raw logs instead. No `hel1435`
  containers or volumes remain (`docker ps -a` / `docker volume ls`: 0).

### Phase 1: Spec Review — FAIL

- AC1 (bounded thin, rank once, plans/timings/temp before and after): met in code. `HistoryThinBatching.thin` uses one
  window (`row_number` + `lag`). `deleteAbove = protectedNewest + 1` is the correct translation of "the newer row is
  unprotected". The oracle `OldSingleStatementThin` matches the removed SQL verbatim (I diffed it against
  `22f4c1fd3`: the only difference is where the `strictest` val sits). I spot-checked plan acceptance at R=25,000:
  `Seq Scan on output_snapshot_history` appears in 0 of 12 delete plans (S2 desktop and prod-io-base) and 0 of 24
  (S4, both profiles). At R=250,000 it appears in 9 of 21, as reported.
- AC2 (bounded catch-up on a scratch DB): met. I checked the survivor diffs, e.g.
  `survivor-diff-S4-prod-io-base-R25000.log`: all four EXCEPT counts are 0.
- AC3 (prod-class measurement or a justified proxy): met, with D7's fallback (see executor point 6 below).
- **AC4 (commit raw logs for insert-path, build timings and all EXPLAIN runs): NOT met.** The repo `.gitignore:27`
  ignores `*.log`. As a result 229 of the 247 files in `evidence/` are on disk but not in the commit. The commit
  tracks only 18 (`*.serverlog.txt`, `*.out`, `*.txt`, the ctid README). Missing from the commit:
  - every `v120-insertpath-*.log` (the exact HEL-1284 gap this AC names);
  - every `old-*.log` (all EXPLAIN runs of the old statement);
  - every `dry-*.server.log` (all batch plans);
  - `survivor-diff-*.log`, `drain-*.log`, `io-probe.log`, `refusal-test.log`, `migrate.log`, `teardown.log`;
  - the red, mutation and green logs.

  `measurements.md` sections 2, 3, 11, 12 and 14 cite these files, so the committed document points at evidence that
  does not exist in the repo. Once `cleanup.sh --phase4` removes the worktree, the evidence is lost. This repeats
  HEL-1284's failure mode exactly.
- **Spec scenario "Lock held part-way through a pass" (ADDED requirement "Thinning runs in bounded batches") is not
  covered.** This is task 4.3: "lock taken mid-pass ... retry resumes".
  - `OutputHistoryBatchedThinSpec.scala:168-185` takes the lock between passes (`maxBatches = 1`). So the
    `LockHeld(deleted, cursor)` branch at `OutputHistoryRepository.scala:129` is only exercised with `deleted == 0`
    and `cursor == startAfter`.
  - Mutating that line to `LockHeld(0, startAfter)` would survive every test. That mutation drops the in-pass cursor
    advance and the committed-deleted count.
  - The test's "retry" (`:182`) is `thinAndPurge`, which drains from `None`. It never asserts that the retry resumes
    at the cursor.

  The test name is honest, and the executor disclosed this. The spec scenario is still a stated requirement with no
  test behind it.
- Task 2.1 (script SQL textually diffed against the Scala SQL): the "vacuous" claim holds for the new path.
  `HistoryThinMeasure.scala:68-101` calls `HistoryThinBatching.candidates/admit/ageDelete/thin` and `:130` calls
  `repo.thinPass`, so there is no SQL copy that could drift. For the old path, every survivor diff and committed old
  drain uses the Scala oracle (`:155`). Only the rolled-back timings and plans use the literal-substituted SQL script,
  and section 13 says so. Accepted. `tasks.md` 2.1 still describes a "Perf SQL script for the batched thin" that does
  not exist (non-blocking, see below).
- D5 deviation: disclosed, but the stated rationale is partly wrong (Change Request 4).
- Constraints C1-C5: honored.
  - C1: exact-name teardown is recorded in `teardown.log`, and I verified 0 leftovers.
  - C2: my own run.
  - C3: `RetentionLockGuardSpec` asserts SQLSTATE `55P03` and rolls back and closes in `finally`.
  - C4: measurements sections 9 and 11 carry the labels.
  - C5: the test expects the empty 5th pass.
- Scope: no creep. CLAUDE.md env rows were added. No migration.

### Phase 2: Code Review — FAIL

- **The branch is stale against `origin/main`, and the merge result would fail a guard on main.**
  - `origin/main` has moved 8 commits (HEL-1425 through HEL-1436). `git merge-tree` reports a textually clean merge.
  - HEL-1445 (`719710c15`) added `EmbeddedPostgresStartGuardSpec`. It fails the suite on any `EmbeddedPostgres` start
    that is not wrapped by `VerifiedEmbeddedPostgres.start(...)`.
  - The new `OutputHistoryBatchedThinSpec.scala:34` uses
    `EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()` directly, so the merged tree
    goes red.
  - HEL-1468 (`5ba82b39f`) also changed how sbt reports lost failures. The gate I ran is valid only for the
    un-rebased branch.
- **New compiler warnings.** `private sealed trait BatchResult` is nested inside `class OutputHistoryRepository`
  (`OutputHistoryRepository.scala:154-159`), which produces four warnings: "The outer reference in this type test
  cannot be checked at run time" (`:130`, `:131`, `:157`, `:158`). They are visible in `evidence/red-stub-ignores-budgets.log`
  and the line numbers match HEAD.
- **Readability:** `OutputHistoryRetentionService.scala:43-47` inserts the new `cursor` val and its scaladoc between
  `nextDue`'s scaladoc and `nextDue`. As a result `nextDue`'s doc (the reference-equality CAS note) is now a dangling
  comment, and `nextDue` itself has none. There is also a typo `thined` at `OutputHistoryRepository.scala:179`.
- Correctness:
  - D2 equivalence logic: correct.
  - Age `CASE`/`COALESCE(array_position)`: correct. `users.tier` is `TEXT` (V88), and the extra
    `captured_at < strictest` is implied by every tier's cutoff.
  - Admission bound and first-always-admitted floor: correct.
  - Service precedence: failure > lock-held > more-work > complete. `claim` and CAS interplay is correct.
  - Cursor is kept on failure and reset on completion.
  - Tests are meaningful: a 216-combination oracle guard plus precedence cases with stubs that record the cursor.
- Executor point 5:
  - Production calls `thinPass` (`OutputHistoryRetentionService.scala:66`). Nothing in `src/main` calls
    `thinAndPurge`.
  - Even if someone called it, it runs bounded per-batch transactions, never one large one. It is unbounded only in
    pass wall time.
  - It is a test-only helper living in production code, and three doc comments still point at it as the retention
    path (`NodePayloadHistoryRepository.scala:129,160`, `OutputHistoryRepository.scala:46`). Non-blocking.
- Security, error handling and types: fine. `positiveInt` clamps overflow, and the clamp is tested.

### Phase 3: UI Review — N/A

Backend-only change: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` files changed.

### Executor's flagged points, weighed

1. **Total work 1.7-5.4x: honestly reported.** It is in the measurements section 1 verdict table and section 6.3. It
   does not break an AC, which asks for bounded work, not cheaper work. Its real consequence is pass wall time, which
   the measurements do not connect to the scheduler (CR 4).
2. **D5 deviation (R=25,000, M=60, N=500): disclosed, but the M justification is wrong.** See CR 4.
3. **Mid-pass lock scenario: not covered.** See Phase 1 and CR 3.
4. **Task 2.1 vacuous: holds.** See Phase 1.
5. **`thinAndPurge` wrapper: production uses the bounded `thinPass`.** The wrapper cannot reintroduce a single large
   transaction. Non-blocking cleanup suggested below.
6. **Hardware figures as assumptions: acceptable under D7's fallback.**
   - Each figure carries a URL and an ASSUMPTION label.
   - Each is bracketed by the three sensitivity runs D7 names: IO on/off, `--cpus` 0.5/1.0, `shared_buffers`
     128/570 MB.
   - The IO throttle is shown to bite (`io-probe.log`: 4.9 MB/s throttled vs 4.9 GB/s unthrottled).
7. **Red-first and mutation logs: real behavioural reds**, but uncommitted (CR 1).
   - `red-stub-ignores-budgets.log`: `Completed(456) was not an instance of ...MoreWork` and
     `1 was not greater than or equal to 2`. The lock test's red is a `ClassCastException` from `asInstanceOf`, which
     is still behaviour-driven.
   - mutation-1 fails the oracle guard; mutation-2 fails three tests.
   - D10 (i) and (ii) each fail the REVERSE test.

### Overall: FAIL

### Change Requests

1. **Commit the evidence.**
   - Run `git add -f openspec/changes/bound-history-thinning-batches/evidence/` so that every `*.log` cited by
     `measurements.md` is tracked: `v120-insertpath-*`, `old-*`, `dry-*`, `drain-*`, `survivor-diff-*`, `io-probe`,
     `refusal-test`, `migrate`, `seed-*`, `vacuum-*`, `report-*`, `teardown`, `red-*`, `mutation-*`, `green-*`, and
     `d9-seed`.
   - Total is about 20 MB, of which `green-testFull.log` is 9 MB. If size is a concern, trim that one to its summary
     and the spec lines, and say so.
   - Verify with `git ls-files openspec/changes/bound-history-thinning-batches/evidence | wc -l`, which should equal
     the on-disk count, and with zero `git status --ignored` hits under `evidence/`.
2. **Rebase onto `origin/main` and fix the embedded-Postgres start.**
   - Change `OutputHistoryBatchedThinSpec.scala:34` to
     `VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))`
     (import `com.helio.testkit.VerifiedEmbeddedPostgres`).
   - Re-run `sbt -J-Xmx3g testFull` on the rebased tree, grep for `TESTS FAILED` / `*** FAILED`, and confirm
     `EmbeddedPostgresStartGuardSpec` passes.
3. **Cover "Lock held part-way through a pass" at the repository level.**
   - Add a deterministic test that runs a pass with `maxBatches >= 2` in which batch 1 commits and the lock is then
     taken before batch 2. One way: a test `DbContext` subclass passed to `OutputHistoryRepository` whose
     `withSystemContext` takes `pg_advisory_lock_shared(RetentionLockKey)` on a side connection after its first
     completed transaction.
   - Assert all of the following:
     - (a) the outcome is `LockHeld(d, Some(lastIdOfBatch1))` with `d > 0`;
     - (b) batch 1's Outputs equal the oracle result and the remaining Outputs are untouched;
     - (c) after the lock is released, `thinPass(..., startAfter = that cursor)` resumes there.
   - To make (c) observable, insert a fresh thinnable point into a batch-1 Output before the retry, and assert it
     survives the retry pass. This proves the retry did not restart the cycle. The final drain should still reach the
     oracle survivors.
   - Record a red: mutate `OutputHistoryRepository.scala:129` to `LockHeld(0, startAfter)` and show the new test fails.
4. **Correct the D5 deviation rationale for `OUTPUT_HISTORY_THIN_MAX_BATCHES_PER_PASS`.**
   - `measurements.md` section 10 says "A larger R or M ... doubles-to-triples the longest transaction". That is true
     of R only. M never lengthens a transaction.
   - M's real cost is pass wall time, and that time blocks the whole scheduler tick:
     - `PipelineSchedulerService.scala:119-127` zips `historyWork` into the tick future;
     - `PipelineSchedulerActor.scala:47-56` arms the next `Tick` only on `TickCompleted`.
     - So a retention pass delays every scheduled run and auto-run debounce for its full duration.
   - At M=60 the measured S4 prod-io-base pass is 147 s, which is longer than the old single tick (109.6 s, section 6.3).
   - Either:
     - (a) pick M so the measured prod-class deep-backlog pass is at or below a stated bound (e.g. at or below the old
       tick, or under 60 s, which is about M=20-25 from the 300-batch / 588 s drain); or
     - (b) keep 60 and state the scheduler-stall trade-off explicitly in section 10 and the CLAUDE.md row.
   - Update the default and the CLAUDE.md row if M changes.
5. **Remove the new compiler warnings and the misplaced scaladoc.**
   - Move `BatchResult` (`OutputHistoryRepository.scala:154-159`) into `object OutputHistoryRepository`, or into
     `HistoryThinBatching`, so the type tests are not on an inner class.
   - In `OutputHistoryRetentionService.scala:43-47`, put `nextDue`'s scaladoc back directly above `nextDue`.
   - Rename `thined` to `thinned` (`OutputHistoryRepository.scala:179`).

### Non-blocking Suggestions

- `thinAndPurge` is now a test-only drain helper. Move it to `testsupport`, or mark it test-only in its scaladoc. Also
  update the stale doc references that call it the retention path: `NodePayloadHistoryRepository.scala:129,160` and
  `OutputHistoryRepository.scala:46`.
- Update `tasks.md` 2.1 to describe what shipped: no SQL copy of the batched thin; the Scala driver runs
  `HistoryThinBatching`; the diff is vacuous, see measurements section 13.
- `thinPass`'s `MoreWork(deleted, cursor.getOrElse(""))` (`OutputHistoryRepository.scala:127`) is unreachable with
  `None` because `maxBatches >= 1`. A comment, or a typed non-empty cursor, would make that self-evident.
