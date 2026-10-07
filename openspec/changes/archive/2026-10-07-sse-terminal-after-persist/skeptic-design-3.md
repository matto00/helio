## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`. The planning artifacts are uncommitted in the change dir. I read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-run-sse/spec.md and skeptic-design-2.md. Every claim below was checked against the source. None is taken from the design's wording.

### What I verified (with evidence)

**Round-2 CR1 (how the lock is acquired for real runs): addressed and buildable.**
- `PipelineRunService` has the constructor parameter `executionBackend: PipelineExecutionBackend = null` (`PipelineRunService.scala:71`, used at :164).
- `PipelineExecutionBackend` is a trait. `supportsWriteBack` defaults to `false` (`PipelineExecutionBackend.scala:27`).
- `InProcessExecutionBackend` is `final` but publicly constructible: `(engine, stepRepo)`, `supportsWriteBack = true` (`InProcessExecutionBackend.scala:22,26`). A wrapper that delegates to it is buildable. D4 explicitly requires delegating `supportsWriteBack`, which the `runPipeline` reject at :374 needs.
- `backend.execute` is called only after `preExec` (`insertRunIfUnderConcurrencyCap` plus `deleteOldRuns`) has completed (:1042-1084). So when `execute` is entered, the run row is committed and can be locked with `FOR UPDATE`.
- Nothing between `execute` returning and each path's publish writes the `pipeline_runs` row or takes a key-share lock on it:
  - `executeRunFailure` publishes first (:1124).
  - `onBlockedRun` publishes first (:1356).
  - On the write-back path, the only work before the publish is `applyPendingWriteBacks`, which writes data_sources and dataset rows (:1313).
  - `onUnblockedRunSuccess` publishes first (:1397).
  - So on unmodified code, every real-run case publishes while the lock is held: red as required. After the fix, `updateRunTerminal`'s `UPDATE` blocks: green.
- The racy "wait for `running`, then lock" approach is explicitly forbidden.

**Round-2 CR2 (snapshot lock not vacuous): the lock itself is now correct.**
- The replace is `DELETE` + `INSERT` (`NodeSnapshotRepository.scala:126-148`). Both take `ROW EXCLUSIVE`, which `EXCLUSIVE` blocks even when there are zero prior rows.
- No main-code path locks `node_snapshots` (the only `FOR UPDATE` in the persistence/pipelines package is on `pipeline_steps`, `PipelineStepRepository.scala:134`). No migration adds a trigger or FK that would make `preExec` write to it. So taking the table lock before submit does not hold up anything before the publish.
- Cross-suite contention is not a concern: each suite has its own EmbeddedPostgres, and `Test / testForkedParallel := false` (`build.sbt:107`).
- **However, see Change Request 1.** The design never isolates this lock's contribution, so it still proves nothing about rows-before-event.

**Round-2 non-blocking notes: addressed.**
- The locks are held on a dedicated JDBC connection outside Hikari.
- dry_run uses `FOR UPDATE`, and `FOR NO KEY UPDATE` is explicitly called out as insufficient. That matches `insertDryRunInternal`'s FK `FOR KEY SHARE` check.

**New defects: none, apart from CR1.**
- D1, D2, D3 and D5 are unchanged and still sound.
- The publish sites I re-read are unchanged: :1124, :1236, :1328, :1356, :1397.
- In `onUnblockedRunSuccess` every write is an eager `val` combined in a for-comprehension (:1556-1571), as the Risks entry says.
- Tasks still cover every AC. No contract delta is needed.

### Verdict: REFUTE

One narrow but load-bearing gap. The ticket AC requires the test to prove that "for `succeeded` the materialized snapshot rows" are readable when the event arrives. Round 2 named the exact implementation this must catch: one that publishes after `updateRun` but before `materializedWrites`.

D4 as written cannot catch it:
- In the succeeded case, the run-row lock and the `node_snapshots` table lock are both held. A partial fix keyed on `updateRun` therefore also produces no event while they are held, and passes assertion 1.
- The non-vacuity check (assertion 3: "a non-test backend with `wait_event_type = 'Lock'`") is satisfied by the `updateRunTerminal` waiter alone. It cannot show that the snapshot lock is holding anything up.
- The design then releases "the locks" together. Whether the partial fix is caught after that depends on a timing race between the `UPDATE` and the snapshot replace, which C6 forbids.

The snapshot lock therefore adds no deterministic evidence. This is the same weakness round 2 raised, now one level down.

### Change Requests

1. **design.md D4 (and tasks.md 1.2): make the succeeded case prove snapshots-before-event on their own.** Either option works:
   - **(a) Staged release.**
     1. Release the `pipeline_runs` row lock first, while still holding `LOCK TABLE node_snapshots IN EXCLUSIVE MODE`.
     2. Assert that no `succeeded` event arrives within the bounded window.
     3. Assert that a service backend is waiting specifically on `node_snapshots`, for example `pg_locks` with `relation = 'node_snapshots'::regclass AND NOT granted` from a pid other than the test's, rather than a generic `wait_event_type = 'Lock'`.
     4. Only then release the table lock and assert that the event arrives and the rows are the new run's.
   - **(b) A separate succeeded sub-case** that holds only the `node_snapshots` table lock, with the same relation-specific waiter assertion.

   Also require that the succeeded fixture has at least one Output bound to an executed node and a non-null `nodeSnapshotRepo`. Otherwise `materializedWrites` is a no-op (:1408) and the table lock blocks nothing. The relation-specific waiter check is what makes that misconfiguration fail loudly.

   More generally, every lock D4 names should have its non-vacuity checked against its own relation or row, not just "some backend waiting on Lock". One generic waiter can otherwise vouch for a lock that blocks nothing.

### Non-blocking notes
- The exception case says the delegate's Future fails, or a real failing step is used. Either works. A real failing step (a `StepExecutionException`) also covers the `errMsg` branch at :1120-1123.
- For dry_run, "durable state still pre-terminal" means no `pipeline_runs` row exists for the run id, since no run row is inserted until `insertDryRun`. It is worth stating that in the spec so the assertion isn't written as a status check against a missing row.
- Round-1/2 note still stands: a 429 from the rate limit or concurrency cap publishes `queued` and never a terminal event. This is out of scope.
