## Evaluation Report — Cycle 4 / re-gate after the HEL-1503 merge (evaluation-4.md)

Reviewed HEAD `8fb498e1e27ed0c8c38d0c61c69c3f3ea29c7811`. It merges `origin/main` `b71af7072` (HEL-1503, #969) into `6536c85a5`.
- After a fresh fetch, `origin/main` is `b71af7072`, which is an ancestor of HEAD, so the branch is up to date.
- The working tree is clean.
- V126 is still unique: `origin/main` stops at V125.

### Phase 1: Spec Review — PASS

**Method: did the merge preserve each side's intent?** I compared each ticket's backend delta before and after the merge, looking only at the changed lines.

- **HEL-1511's delta is intact.**
  - Before the merge: `git diff 2e02b7951 a2eb00ab9 -- backend CLAUDE.md`, the cycle-2 code that passed.
  - After the merge: `git diff b71af7072 HEAD -- backend CLAUDE.md`.
  - These are identical except for one line in `PipelineRunService.scala`, the executor construction. It now takes both HEL-1503's leading `pipelineRepo` and HEL-1511's trailing `liveRunTracker`.
- **HEL-1503's delta is intact.**
  - Before the merge: `git diff 2e02b7951 b71af7072 -- backend`.
  - After the merge: `git diff a2eb00ab9 HEAD -- backend`.
  - Both are 11 files, 814 insertions and 59 deletions. They are identical except for that same constructor line.
  - In the conflicted companion object, the resolution keeps both `ReapedRun` and the `RunAuthorization` ADT, plus HEL-1503's `PipelineGone` arm and its reworded scaladoc.

**Commit hygiene.** `6536c85a5` and `8fb498e1e` contain no `claude.ai` session link and no `Claude-Session` trailer. The merge subject has the `HEL-1511` prefix.

**openspec.** `check-openspec-hygiene` reports "openspec/ is clean".

### Phase 2: Code Review — PASS

**HEL-1511 invariants, verified by reading the merged code:**
- **Register/deregister** (PipelineRunExecutor.scala:198-204): unchanged. The run registers only on `preExec`'s `Right`. `Future.delegate(runAdmitted(...)).andThen(deregister)` wraps the engine and every terminal chain.
- **Open-check** (`isStillOpen` at :357/:368): still before `applyPendingWriteBacks`.
- **Conditional terminal writes.** `updateRunTerminalInternal` filters on `completedAt.isEmpty` (PipelineRunRepository.scala:328). `afterTerminalWin` gates `updateMeta` and `assertionsInsert` in the success chain (SucceededWrites :236/:243), and also gates the failure, blocked and write-back paths.
- **System context.** `stampHeartbeatsInternal` (:341), `reapStaleRunsInternal` (:356) and `isRunOpenInternal` (:335) all run under `ctx.withSystemContext`.
- **Initial heartbeat.** Both admission paths still insert through `insertRunRowAction` (:201), which sets `heartbeatAt = Some(startedAt)` (:107).

**HEL-1503's new paths checked against those invariants:**
- **`PipelineGone` / `NotAuthorized` admission arms:** return `Left` before any row is inserted and before `register`. There is no row to reap and nothing to deregister.
- **Empty-roots existence check** (`findByIdInternal`): runs before admission, and inserts and registers nothing.
- **Dry-run `checkRunAuthorizationInternal`:** dry runs are never tracked (`tracked = !isDry && ...`). They insert an already-terminal row, which the reaper excludes (`status <> 'dry_run'`). This adds no exit path that skips deregistration.
- **Editor `baselineUpsert`** (owner-scoped or `updateLastSourceSchemaInternal`): it sits inside `onUnblockedRunSuccess`. That is only reached after the open-check passes, so a reaped run never writes it.
  - Like the owner path it stays eager and is not gated on the terminal write winning. That is the same open-check-to-terminal-write window the design already accepted (Risks, bullet 2), not a new bypass.
- **`FOR KEY SHARE` admission lock against the reaper's pipeline update.** The reaper's `UPDATE pipelines SET last_run_*` changes no key columns, so it takes `FOR NO KEY UPDATE`, which does not conflict with `FOR KEY SHARE`. There is no new blocking or deadlock edge.
- **New terminal-write or run-insert paths:** HEL-1503 adds none.

**Affected specs (my fresh targeted run on HEAD 8fb498e1e, `nice -n 19`).**

Specs run:
- the reaper specs: `OrphanedRunReaperSpec`, `LiveRunReaperSpec`, `RunReaperConcurrencySpec`, `PipelineRunGuardConfigStaleSpec`;
- HEL-1503's specs: `Hel1503EditorRunGapsSpec`, `PipelineRunEditorPersistenceSpec`, `ExistenceNotLeakedRoutesSpec`;
- the run-service, executor, scheduler and auto-run specs: `PipelineRunService*`, `*Executor*`, `PipelineScheduler*`, `*AutoRun*`, `FireTimeRunConfigGateSpec`, `PipelineRunGuardIntegrationSpec`;
- persistence, Spark and routes: `com.helio.infrastructure.persistence.pipelines.*`, `SparkJobSubmitterSpec`, `PipelineRunRoutesSpec`.

Result:
- `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`
- `Suites: completed 44, aborted 0`
- `Tests: succeeded 613, failed 0`
- `exit=0`

Each named spec appears in the output. No sbt or java process was left running.

**Other checks.**
- I did not run a full testFull, as instructed: the final skeptic is running one, and the machine cap is 2.
- The executor's `hel1511-testFull-cycle3.log` reports `Tests: succeeded 7375, failed 0, canceled 4`. That is its claim. My targeted run covers every spec on the merged paths.
- `check:scala-quality` is clean.

### Phase 3: UI Review — N/A
Neither merge side changes the frontend, schemas or routes. HEL-1503 changes status codes on existing endpoints (404 for a deleted pipeline), and that is covered by `ExistenceNotLeakedRoutesSpec`. As in earlier cycles, I did not start dev servers because of the shared-dev-DB V126/reaper hazard.

### Overall: PASS

### Non-blocking Suggestions
- **PR body:** still needs the read-only prod count query and the Q5 "Behaviour changes / data effects" note.
