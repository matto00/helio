## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `8fb498e1e27ed0c8c38d0c61c69c3f3ea29c7811`. This is the merge of origin/main (HEL-1503, b71af7072) into the reaper branch. The review was cold: I derived every conclusion below from the diff, the code and runs I made myself.

### What I verified (with evidence)

**Ground truth / base**
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/orphaned-run-reaper/hel-1511`.
- I ran `git fetch origin` first, then `resolve-review-base.sh` returned `BASE=b71af7072ef6e7e7603c097c3e18276d4f18b318` (exit 0), which equals `origin/main`.
- `git merge-base --is-ancestor origin/main HEAD` reports `ANCESTOR_OK`.
- V126 is free on freshly fetched origin/main: `git ls-tree origin/main .../db/migration/ | grep V12[5-9]` lists only `V125__auto_run_debounce_guard_retry_count.sql`. The branch adds `V126__pipeline_runs_heartbeat.sql`, which is additive (`ADD COLUMN heartbeat_at TIMESTAMPTZ NULL`).
- Commit hygiene: `git log --format='%H%n%B' origin/main..HEAD | grep -niE "claude\.ai|Claude-Session"` finds nothing (exit 1) across all 5 branch commits.
- No frontend change (`git diff --stat -- frontend` is empty), so the UI/design step does not apply.

**Merge resolution (`git show --cc 8fb498e1e`)**
- `PipelineRunService.scala`: the resolved line is `new PipelineRunExecutor(pipelineRepo, ..., succeeded, liveRunTracker)`. It takes HEL-1503's new leading `pipelineRepo` and the reaper's trailing `liveRunTracker`, and both parameter lists match the executor's constructor.
- `PipelineRunRepository` companion: `ReapedRun`, HEL-1503's `RunAuthorization` ADT and `ConcurrencyCapResult.PipelineGone` all coexist, with no semantic overlap.
- `PipelineRunExecutor` and `PipelineRunSucceededWrites` were auto-merged. I read both in full on HEAD:
  - HEL-1503's new `pipelineOwnerId` parameter flows `onRunSuccess` → `unblockedChain` → `onUnblockedRunSuccess`.
  - HEL-1503's editor-aware `baselineUpsert` sits in the same `for` as the reaper's reordered `updateRun` → `updateMeta` (gated by `afterTerminalWin`) → `assertionsInsert` (gated).

**HEL-1503 paths vs. the reaper's invariants (adversarial)**
- **Post-admission exit that skips deregistration: none.**
  - `register` happens only on `preExec`'s `Right(())`, which only the `Inserted` arm produces for a real run (`PipelineRunExecutor.scala:198-205`).
  - HEL-1503's `PipelineGone`, `NotAuthorized`, `CapExceeded` and its dry-run `checkRunAuthorizationInternal` arms all return `Left` before `register`. Dry runs have `tracked = false`.
  - Once registered, `Future.delegate(runAdmitted(...)).andThen(deregister)` covers every exit: the engine failure, success, blocked and write-back paths, plus synchronous throws.
  - One case is not new: a failure in `deleteOldRuns` retention, after insert and before `Right`. That arm `recoverWith`s to success, so it cannot leave an unregistered, never-terminated row.
- **Run insert that skips `heartbeat_at`: none.**
  - Every queued-row insert goes through `insertRunRowAction`, which sets `heartbeatAt = Some(startedAt)`. That covers `insertRun`, `insertRunInternal` (Spark, `recordUnrunnable`), and `countAndInsertAction` on both HEL-1503 admission paths (owner `:162`, editor `:236`).
  - The only other `PipelineRunRow(` construction is `dryRunRowAction`, which inserts a row that is already terminal.
- **Terminal write that skips first-terminal-write-wins: none.**
  - Every caller of `updateRunTerminal`/`updateRunTerminalInternal` goes through the `completed_at IS NULL`-filtered statement: `writeTerminal` (owner and editor), `recordUnrunnable`, and both Spark sites.
  - HEL-1503 added no new terminal write. Its editor-run baseline write (`updateLastSourceSchemaInternal`) happens after the executor's `isRunOpenInternal` open-check, and is subject to the same documented accepted window (design.md Risks) as the snapshot writes.

**AC trace on HEAD**
- **AC1/AC2:** `OrphanedRunReaperSpec`.
  - Cases (a) auto-run, (b) schedule and (c) cap-slot on another pipeline.
  - `tick()` reaps first: `PipelineSchedulerService.tick` → `orphanReaper.reap(now).flatMap(_ => runPasses(now))`.
  - The red-first evidence is in the earlier rounds' archive. I did not re-derive it on main.
- **AC3:** `LiveRunReaperSpec` "never be reaped while the heartbeat stamps it".
  - My mutation M3 (below) shows the test depends on the real admission → register path.
  - Production wiring: `Main` spawns `RunHeartbeatActor` with `apiRoutes.pipelineRunService.liveRunTracker`. `ApiRoutes.scala:445` is the only `new PipelineRunService(` in main, so the scheduler and the routes share one tracker.
  - `stampHeartbeatsInternal` uses `ctx.withSystemContext`, as required for RLS.
- **AC4:** `RunReaperConcurrencySpec` covers heartbeat-vs-reap, reap-vs-reap and a control. The reap is one `UPDATE ... WHERE completed_at IS NULL AND <staleness>` CTE under system context.
- **AC5:** `DatasetWriteAutoRunDroppedFireSpec` cases (d), (e) and (f) pass in my full run. For the floor and case-(d) mutation evidence I relied on the prior rounds and did not re-mutate.
- **AC6:** the `PipelineAutoRunDebounceFirer` DEBUG line and the `RearmOutcome.Superseded` scaladoc both now name the "another instance took over a stale claim" case. Verified in the diff.
- **AC7:** V126 is free, as above. The owner-approved legacy reap is covered by the 1 h bound (`LegacyRunStaleAfterSeconds = 3600`).

**Full backend suite (fresh, run by me)**
- Precheck: `ps ... | grep -c "[s]bt.*testFull"` returned `0`, and MemAvailable was 48.9 GB.
- `nice -n 19 sbt -J-Xmx3g testFull` on HEAD exited 0:
  - `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`
  - `Total number of tests run: 7375` / `Suites: completed 556, aborted 0` / `Tests: succeeded 7375, failed 0, canceled 4`. The 4 canceled are the existing HELIO_MEASURE report-only and latency-budget cases.
- These suites appear in the output: `RunReaperConcurrencySpec`, `DatasetWriteAutoRunDroppedFireSpec`, `PipelineRunEditorPersistenceSpec`, `Hel1503EditorRunGapsSpec`, `OrphanedRunReaperSpec`, `PipelineRunGuardConfigStaleSpec` and `LiveRunReaperSpec`.

**Mutations (my choice; run on a `git archive HEAD` copy in the session scratchpad, so the worktree was never edited)**
- **M3:** admission registration disabled (`if (false) liveRunTracker.register`). `LiveRunReaperSpec` "never be reaped while the heartbeat stamps it" went **FAILED**; the other 4 passed. This proves AC3 runs through the merged HEL-1503 admission path.
- **M2:** `isStillOpen` forced to `true`. "stay failed and write no snapshot, history or write-back row" went **FAILED**.
- **M1:** `updateRunTerminalInternal` filter reduced to `id === runId` (no `completedAt.isEmpty`). Four tests went **FAILED**:
  - "not overwrite a reaped run ... report false"
  - "finalize an open run exactly once (control)"
  - "keep the reaper's failed row and last_run_* (failure path)"
  - "(blocked path)"
- `diff -r` against the worktree confirmed that each mutation was the only difference.

sbt hygiene: every sbt invocation I started was batch mode and has exited. The remaining sbt/java processes have cwds in the hel-1508 and HEL-1515 worktrees, not mine. I did not start this branch's backend server.

### Verdict: CONFIRM

### Non-blocking notes
- **Post-admission pipeline delete (HEL-1503 interaction).**
  - `pipeline_runs.pipeline_id` is `ON DELETE CASCADE` (V24).
  - So if a pipeline is deleted after admission while its run executes, the run row disappears and `isRunOpenInternal` returns false.
  - The executor then answers `Conflict("Run was already finalized as abandoned before it finished")` and logs the "reaped as abandoned" WARN.
  - Skipping the write-backs here is arguably correct, but the message and log blame a reap that never happened.
  - HEL-1503 only promised 404 for a delete *at admission*, so no requirement is broken. A follow-up could tell "row gone" from "row terminal" and answer `NotFound`.
- Branch commit `191a3128c` ("Merge remote-tracking branch 'origin/main' into ...") lacks the `HEL-1511` prefix (C2). The squash-merge commit title makes this moot.
- `baselineUpsert` (now including HEL-1503's editor-privileged write) is eagerly started and not gated by `afterTerminalWin`. That matches design.md's accepted open-check → write window. It is noted only because HEL-1503 widened what that window can write.
