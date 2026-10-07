## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`. The planning artifacts are uncommitted in the change dir. I read proposal.md, design.md, tasks.md, specs/pipeline-run-sse/spec.md, ticket.md and skeptic-design-1.md. Every claim below comes from the source and SQL, not from the design's wording.

### What I verified (with evidence)

**Round-1 items**
- **CR2 (write-back failure is mandatory): addressed.**
  - D4 lists write-back failure among its mandatory cases. Task 1.2 names "failed (exception, blocked, write-back)".
  - The fixture exists and drives `onWriteBackFailure` to a persisted `failed`: `PipelineRunServiceUpsertSourceSpec.scala:184-199` asserts `lastRunStatus(pid) shouldBe Some("failed")`.
- **Spec scope note: addressed.** Both new scenarios now say "for a run that has a persisted run record".
- **Eager-val risk note: addressed.** It is in Risks and is routed to files-modified.md.
- **CR1 (determinism): partly addressed.** Lock-holding is the right family of mechanism. Checking it against the SQL found one real gap and one underspecified lock, below.

**Can each named lock block its path's terminal write?**

1. **`pipeline_runs` row update: the lock blocks the write, but D4 never says when to take it.**
   - `updateRunTerminal` (`PipelineRunRepository.scala:172-197`) runs an owned-run `SELECT` join, which a lock does not block. It then calls `updateRunTerminalInternal` (`:199-213`), a plain `UPDATE pipeline_runs … WHERE id = ?`. A `FOR UPDATE` row lock held on another connection blocks that `UPDATE`.
   - `persistAssertions` inserts into `pipeline_run_assertions`, whose FK check takes `FOR KEY SHARE` on the run row. That also conflicts with `FOR UPDATE`.
   - **The gap: the row lock cannot be taken before submit.** The row does not exist until `insertRunIfUnderConcurrencyCap` inserts it inside `executeRun`'s `preExec` (`PipelineRunService.scala:1042-1056`, runId generated at :999). That happens in the same `submit` call, milliseconds before `backend.execute` starts.
   - No pre-submit lock blocks only the `UPDATE`:
     - Table-level `INSERT` and `UPDATE` both take `ROW EXCLUSIVE`.
     - A `FOR UPDATE` on the parent `pipelines` row would block the queued insert's FK check, so pre-fix nothing terminal is published and the test passes green on unmodified code.
   - So for 4 of the 5 mandatory cases (succeeded, exception-failed, assertion-blocked, write-back-failed), the test must get the lock into the window between the insert committing and the terminal write. D4 does not say how.
   - The obvious reading, "wait for the `running` event, then lock", is a race against an engine that takes milliseconds. That is the timing dependence C6 forbids. After the fix it can also go falsely red: if the writes finish before the lock lands, the event is published, correctly, "while the lock is held".
2. **`node_snapshots` replace: underspecified, and the obvious row lock does nothing on a first run.**
   - The replace (`NodeSnapshotRepository.scala:123-154`) is `DELETE … WHERE pipeline_id/node` followed by `INSERT`s, in one transaction.
   - `node_snapshots` has **no FK to `pipelines`** (`V94__outputs_model.sql:278-284`; V98 comment at :165-166: "nothing deletes node_snapshots when a pipeline is deleted"). A `pipelines`-row lock therefore does not block it.
   - `FOR UPDATE` on the Output's snapshot rows blocks the `DELETE` only if such rows already exist. On a first run there are zero, so the lock is vacuous and the `INSERT`s go through.
   - This matters because the observed CI symptom was **stale rows**. A vacuous snapshot lock still lets a post-fix run pass even if the implementation publishes after `updateRun` but before `materializedWrites`. The rows-before-event guarantee would then never be proven.
3. **`insertDryRun`: confirmed, works as written.**
   - `insertDryRunInternal` (`PipelineRunRepository.scala:228-242`) is an `INSERT` into `pipeline_runs`. That table has `pipeline_id … REFERENCES pipelines(id)` (`V24__pipeline_runs.sql:3`), so the insert's FK check takes `FOR KEY SHARE` on the parent row, which `FOR UPDATE` blocks. (`FOR NO KEY UPDATE` would *not* block it.)
   - On the dry path, nothing before the publish writes or key-share-locks the `pipelines` row:
     - `submit`: `auditSubmit` is skipped for dry runs (:225).
     - `runPipeline`: reads only.
     - `executeRun`: dry runs skip `preExec`. The rate-limit table `pipeline_run_rate_window` has an FK to `users` only (`V109:15`).
   - So taking `FOR UPDATE` on the `pipelines` row before submit deterministically blocks `insertDryRun` and nothing earlier: red before the fix, green after.

**Cheap deterministic fixes exist in the repo** (this is why the gap is a REFUTE and not an ESCALATION):
- `PipelineRunService` takes an injectable `executionBackend: PipelineExecutionBackend` constructor param. `PipelineRunGuardIntegrationSpec.scala:145-170` already has a `GatedExecutionBackend(gate, onAdmitted)` test helper: `onAdmitted` fires inside `execute`, after `preExec` has committed the run row, and the run waits on a test-controlled gate. This is the window the row lock needs, and it is not a new production seam.
- `InProcessExecutionBackend` overrides `supportsWriteBack = true` (`InProcessExecutionBackend.scala:26`). The `GatedExecutionBackend` precedent inherits `false`, and `runPipeline` (~:366-370) rejects an `upsertsource` pipeline before `executeRun` when that is `false`. A gating wrapper has to delegate `supportsWriteBack`, or the write-back case never reaches `onWriteBackFailure`.
- Alternative for the real-run paths: before submit, hold `SELECT … FROM pipelines WHERE id = ? FOR NO KEY UPDATE`.
  - It does not conflict with the queued insert's `FOR KEY SHARE` FK check.
  - It does block `pipelineRepo.updateLastRun`, which is in every real terminal chain: `executeRunFailure` :1139, `onWriteBackFailure` :1335, `onBlockedRun` :1359 and `onUnblockedRunSuccess` :1563.
  - Nothing before the publish updates the `pipelines` row.

**Other checks**
- D1/D2/D3 are unchanged from round 1 and still sound.
- The publish sites I re-read in the current source are unchanged: `executeRunFailure` :1124, `onDryRunSuccess` :1236, `onWriteBackFailure` :1328, `onBlockedRun` :1356, `onUnblockedRunSuccess` :1397.
- Tasks cover every AC: the backend proof is 1.2-1.4, the hel1094 repeat run is 3.2, and the helper moves are 2.1-2.3 and 3.3. No scope drift. No API, schema or migration change, so no contract delta is needed.

### Verdict: REFUTE

The design's own binding constraint (C6: deterministic, never timing-based) is not yet met for 4 of the 5 mandatory cases. The run-row lock blocks the write, but D4 leaves taking it to an unstated, racy step. The snapshot lock is unspecified, and its natural reading is vacuous on a first run. Both fixes are a few lines of design text.

### Change Requests

1. **design.md D4 / tasks.md 1.2: specify how the lock is acquired for the real-run cases (succeeded, exception-failed, assertion-blocked, write-back-failed).** Pick one and state it:
   - **(a) Gate the engine.** Inject a gating `PipelineExecutionBackend` that delegates to the real `InProcessExecutionBackend`, including `supportsWriteBack`, following the precedent at `PipelineRunGuardIntegrationSpec.scala:145`. When `execute` is entered, the run row is committed. Take `FOR UPDATE` on it from a dedicated connection, then open the gate. For the exception case, the delegate's Future fails, or a real failing step is used.
   - **(b) Lock the pipeline row before submit.** Take `FOR NO KEY UPDATE` on the parent `pipelines` row before submit. It blocks `updateLastRun`, which is in every real terminal chain, without blocking the queued insert.

   Explicitly forbid "wait for the `running` event, then lock" with no gate.
2. **design.md D4: name a lock that provably blocks the `node_snapshots` replace, and require evidence that it is not vacuous.**
   - Name a lock that blocks the replace even on a first run. Examples:
     - `LOCK TABLE node_snapshots IN EXCLUSIVE MODE`, taken before submit. It still allows plain reads, and nothing on the run path before the publish writes `node_snapshots`.
     - Seed a prior snapshot for the node and `FOR UPDATE` those rows.
   - Every case's spec must also show its lock really held up the write before the release, by asserting both of these while the lock is held:
     - the durable state is still pre-terminal: run status not terminal, and for succeeded the snapshot rows not yet the new run's;
     - the service's write is waiting on a lock: `pg_stat_activity.wait_event_type = 'Lock'` for a non-test backend, or equivalent.
   - A lock that blocks nothing must not be able to pass.

### Non-blocking notes
- Hold the test's lock on a dedicated JDBC connection outside the service's Hikari pool. In the succeeded path, several eager writes block at the same time, each holding a pooled connection. A small test pool plus a pooled lock-holder can deadlock the spec rather than turn it red.
- Mandatory dry_run lock: say `FOR UPDATE`, not `FOR KEY SHARE`-conflicting in general. `FOR NO KEY UPDATE` on `pipelines` does not block `insertDryRun`'s FK check. (I confirmed `FOR UPDATE` works, see item 3 above.)
- Round-1 note still stands: a 429 from the rate limit or concurrency cap publishes `queued` (:1018) and never a terminal event. This is out of scope and a possible follow-up.
