## Files modified

- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala` — HEL-1184 fix (H1 confirmed, test-coordination defect): replaces the "rejects more than maxConcurrent REAL concurrent submissions" test's `awaitQueuedCount` DB-poll coordination (removed) with a `CountDownLatch`-based settlement signal (`awaitAllSettled`) that blocks until every one of the 8 submissions has independently settled its own admission decision (admitted-and-entered-`execute()`, via a new `onAdmitted` callback on `GatedExecutionBackend`/`newGatedService`, or rejected, via the submission's own `Future`) before `gate.success(())` is called. Test-only change; no production code (`PipelineRunService.scala`, `PipelineRunRepository.scala`) touched, per H1's scope.

## Root cause (systematic-debugging.md required evidence)

**Root cause:** `PipelineRunGuardIntegrationSpec`'s old `awaitQueuedCount` helper returned as soon as it observed `maxConcurrent` (3) `queued` rows in the DB — but a row is inserted (and thus counted) *before* the admitting submission's own control flow reaches `backend.execute()`. A still-in-flight straggler submission (delayed by connection-pool contention) could therefore still be mid-decision when the poll returned. The test then released the execution gate, letting the 2-3 already-admitted runs complete and free their slots — and when the straggler *then* made its own guard decision, it legitimately observed a freed slot and was admitted, producing 4 (or more) successes against `maxConcurrent = 3`. This is a test-coordination defect (H1), not a guard defect (H2): the guard's own lock+count+insert composition never over-admitted in any of the reproductions below.

**Probe (1.0 — cheapest evidence first):** `git log --all -S"concurrent submissions for the same owner never exceed the concurrency cap" -- backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepositorySpec.scala` → exactly one commit (`29a47220`/`2cc73b4e`, HEL-505), no subsequent fix; standalone run (`sbt "testOnly com.helio.infrastructure.persistence.pipelines.PipelineRunRepositorySpec"`) → 38/38 passed, including "concurrent submissions for the same owner never exceed the concurrency cap". Clean history + clean standalone pass = no red flag for H2; proceeded to instrumentation per design.md Decision 1.

**Probe (1.1/1.2 — instrumentation + forced-small-pool loop):** Added temporary settlement-timestamp logging (admitted = timestamp of entering `GatedExecutionBackend.execute()`, since the guard's admission decision always fully resolves strictly before `backend.execute()` is invoked per `PipelineRunService.executeRun`; rejected = timestamp of the submission's own `Future` resolving with `Left(TooManyRequests)`), each tagged with whether `gate.success(())` had already been called, and forced the test's connection pool down to `Some(2)`/`Some(3)` (mirroring HEL-505 review's own repro methodology; `Some(10)` in the unmodified test). Ran the burst in a bounded, in-process loop (200 iterations) — no external process/OS-level parallelism, single JVM, `nice -n 19`, well under the 3-4-worker hardware cap. Reproduced the over-admission 5 times in 200 iterations at pool=2 (and once directly at pool=3 with 200 iterations). Removed after the fix was verified (see 3.3 below); the exact log evidence is preserved in this commit's history via this file for anyone re-deriving it (`git show` this file's prior version is not applicable since it's newly added — the transcript is in the executor's evaluation record).

Representative log excerpt (iteration 7, pool=3):
```
[iter=7] ADMIT-DECISION #1 entered execute() at +79.3ms gateReleased=false
[iter=7] REJECT-DECISION #4 settled at +87.1ms gateReleased=false
[iter=7] REJECT-DECISION #7 settled at +91.1ms gateReleased=false
[iter=7] ADMIT-DECISION #2 entered execute() at +92.1ms gateReleased=false
[iter=7] GATE-RELEASE at +92.5ms
[iter=7] ADMIT-DECISION #3 entered execute() at +93.4ms gateReleased=true
[iter=7] REJECT-DECISION #2 settled at +99.6ms gateReleased=true
[iter=7] REJECT-DECISION #5 settled at +112.2ms gateReleased=true
[iter=7] ADMIT-DECISION #4 entered execute() at +131.3ms gateReleased=true
[iter=7] OVER-ADMISSION: admitted=4 expected=3
```
5 independent over-admission events (iterations 109, 125, 167, 171, 187 in the 200-iteration/pool=2 run) all showed the SAME shape: at most 2 ADMIT-DECISIONs before `GATE-RELEASE` (the poll-observed 3rd `queued` row had been inserted but not yet reached `execute()`), and every excess admission (3rd, 4th, in one case 5th) settled strictly AFTER `gate.success(())` was called. Zero decisions were ever observed racing each other *before* gate release with an inconsistent/stale count — no evidence for H2 anywhere across 200+30 iterations.

**Hypothesis confirmed (1.3): H1.** H2 (guard-locking defect) is refuted by the same evidence — the guard's own lock+count+insert composition never admitted more than `maxConcurrent` while the gate was held; every over-admission traces to the test releasing the gate before every submission had independently settled.

**Fix (2.1):** `awaitQueuedCount` (DB-poll) replaced with `awaitAllSettled`, backed by a `CountDownLatch(attempts)` that is counted down exactly once per submission — either by a new `onAdmitted: () => Unit` callback threaded through `GatedExecutionBackend`/`newGatedService` (fires on entry to `execute()`, before blocking on the gate), or by the submission's own `Future` resolving with `Left(TooManyRequests)` (via `.andThen`). The gate is only released once ALL `attempts` submissions have independently signalled settlement — never inferred from a row count. No production code changed.

**Fix verification:** re-ran the fixed test in-process, 200 iterations, forced pool `Some(2)` (SMALLER than the pool=3 that first reproduced the bug) — 0/200 over-admissions (`[HEL-1184 stress] iter=200 OK`). Full existing `PipelineRunGuardIntegrationSpec` suite: 10/10 passed standalone at the normal `Some(10)` pool. Full `sbt test` backend suite: see commit body / final report for the fresh run's pass/fail summary.

**2.2 (verify + cite):** `PipelineRunRepositorySpec.scala:639-660` ("concurrent submissions for the same owner never exceed the concurrency cap") is cited as the guard's independent atomicity proof — it drives 12 concurrent writers directly at `insertRunIfUnderConcurrencyCap` (more contention than the 8 in the integration spec) with zero gate/polling confounder, and its own assertion holds under ANY interleaving by construction (the advisory lock's whole purpose). Re-verified standalone in this delivery (38/38, including this test) — no gap found; no new guard-level test added.

**2.4 (mutation-kill, required evidence):** Temporarily replaced the lock-acquisition step in `PipelineRunRepository.insertRunIfUnderConcurrencyCap` (`_ <- concurrencyLockAction(user.id.value)` → `_ <- DBIO.successful(())`) and re-ran `PipelineRunRepositorySpec`'s "concurrent submissions for the same owner never exceed the concurrency cap" standalone: **went RED immediately** (`4 was not equal to 3`, `PipelineRunRepositorySpec.scala:654`) on the very first (non-looped) run — dropping the lock alone reliably breaks the cap's atomicity, proving the cited test is a true-negative check, not merely a test that has never happened to fail. Mutation reverted immediately after (confirmed via `git diff` showing zero changes to `PipelineRunRepository.scala` in this delivery); full suite re-confirmed green afterward.

## Follow-ups considered

None filed — this ticket's scope (probe + fix the confirmed H1 defect) is fully addressed by the test-only change above; no new gap was found in the pre-existing `PipelineRunRepositorySpec` coverage that would warrant a new guard-level test.
