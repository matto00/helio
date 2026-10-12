## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD: 2e02b79511fab222ac2bc73a142fc61e0979f192. This equals origin/main after a fresh `git fetch origin main`. The change dir is untracked planning artifacts only.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/orphaned-run-reaper/hel-1511`.
- **Owner rulings:** I read `.concertino/runs/HEL-1511/hel1511-esc1-context.md` and did not reopen them. D1-D4 still implement Q1-Q6 A. Scope is items 1, 2 and 4; item 3 is listed as a non-goal and in C3.
- **Round-2 CR1 (4.4 could pass vacuously): resolved.** Tasks 4.4 now has all three required parts.
  - (a) It requires a gate that hands off to the real `InProcessExecutionBackend`, following `PipelineRunServiceTerminalOrderingSpec.GatingBackend`, and explicitly not the empty-outcome `GatedExecutionBackend`.
    - I read `GatingBackend` (:203-226). It overrides `supportsWriteBack = delegate.supportsWriteBack` and passes the real `writeBackSink` through to `delegate.execute`.
    - `InProcessExecutionBackend.supportsWriteBack` is `true` (:26). The `upsertsource` pre-check at PipelineRunExecutor:78 therefore admits the run, and the sink really holds a deferred upsert.
  - (b) It adds a positive control: the same fixture, not reaped, writes the target dataset row and a snapshot.
    - Snapshots are written only for nodes that have an `outputs` row (PipelineRunSucceededWrites:72-79).
    - The positive control forces the fixture to bind an Output; without one the control's snapshot assertion would fail. This makes the negative assertions failable.
  - (c) It names the mutation: remove `isRunOpenInternal`, or move it after `applyPendingWriteBacks`. Task 6.1's list of recorded mutation runs now includes 4.4.
  - **Each mutation goes red.** I traced both against the current `onRunSuccess` (PipelineRunExecutor, the blocked branch, then `applyPendingWriteBacks`, then `onUnblockedRunSuccess`):
    - Moving the check after `applyPendingWriteBacks` applies the upsert, so the "target dataset unchanged" assertion goes red.
    - Removing the check also runs `onUnblockedRunSuccess`, which writes snapshots and history before the (now conditional) `updateRun`. So the snapshot/history assertions go red too.
- **Round-2 non-blocking items:**
  - The spec's "First terminal write wins" requirement now names "the rows of any dataset the pipeline writes back to", and its scenario includes write-back dataset rows. The spec now matches D4.
  - Risks now cover clock skew, the 40P01 deadlock between reapers (accepted; recovered by the tick), and the tick-await window on a single instance.
- **Feasibility re-checks against the live tree:**
  - `ServiceError.Conflict(message)` exists (ServiceError.scala:23), so D4's return value is concrete.
  - The highest migration is V125 (`V125__auto_run_debounce_guard_retry_count.sql`), so V126 is free. Task 2.1 still says to re-check it.
  - Existing specs that run a real `PipelineRunService` with `upsertsource` (for example `PipelineRunServiceUpsertSourceRlsSpec` and `PipelineRunServiceTerminalOrderingSpec`) give 4.4 a working fixture precedent.
- **Placeholders, contradictions, AC coverage:**
  - No TODO/TBD markers.
  - Each AC traces to tasks: AC1 to 1.1; AC2 to 3.2, 3.3 and 4.1; AC3 to 4.2; AC4 to 4.3; AC5 to 5.1-5.3; AC6 to 3.5; AC7 to 2.1.
  - No API or schema contract delta is needed: the change adds a column only (no wire shape), and `failed` is an existing status.

### Verdict: CONFIRM

### Non-blocking notes

- 4.4: say explicitly that the fixture binds an Output to the upsertsource step's node (or another node). The positive control already forces this, but naming it saves the executor a red-herring cycle.
- Case (c)'s fixture still reads "orphan plus other in-flight rows". `maxConcurrent = 1` with only the orphan is simpler. This can only fail safe.
- `RunHeartbeatActor`'s 30 s timer is still verified only by reading the code. An actor-level test is optional.
- Date nit, still present: design.md Context and workflow-state say the owner ruled on 2026-10-12. Today is 2026-10-11.
