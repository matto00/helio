## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `191a3128c9f53fba660f1d89c927aa22e22e84fb`, branch `bug/orphaned-run-reaper/hel-1511`.
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/orphaned-run-reaper/hel-1511`.
- Review base, resolved live with `resolve-review-base.sh`: `849dd96c936182d4a8c8597c3cbdc92ae39fcb82`. It equals `origin/main` after a fresh fetch and is an ancestor of HEAD.
- Diff: 36 files, +1872/-81. Backend main: 18 files. Tests: 6. Rest: CLAUDE.md, spec and archive.

### What I verified (with evidence)

**Full backend suite (fresh run, on the worktree at HEAD).**
- Before starting: 0 `sbt.*testFull` processes; MemAvailable 48.5 GB.
- Command: `nice -n 19 sbt -J-Xmx3g testFull`.
- Output:
  - `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`
  - `Total number of tests run: 7362`
  - `Suites: completed 555, aborted 0`
  - `Tests: succeeded 7362, failed 0, canceled 4`
  - `All tests passed.`
  - `EXIT 0`
- Every new and changed case ran and passed: the 8 `OrphanedRunReaperSpec` cases, the 5 `LiveRunReaperSpec` cases, the 3 `RunReaperConcurrencySpec` cases, the 3 `PipelineRunGuardConfigStaleSpec` cases, and `DatasetWriteAutoRunDroppedFireSpec` (d), (e) and (f).

**My own mutations.**
- Where I ran them: a `git archive` copy of HEAD in my scratchpad. No git worktree, no writes to the repo.
- Batch 1: `failed=10`. Batch 2: `failed=4`. Every mutation went red at the assertion that it targets:

| # | Mutation | Red at |
|---|---|---|
| A | `tick()` reaps AFTER the passes (`runPasses(now).flatMap(_ => orphanReaper.reap(now))`) | `OrphanedRunReaperSpec.scala:103/116/136`: `0 was not equal to 1`. This proves the orphan really blocks the auto-run, the schedule and the cap when it is not reaped first. |
| B | Reap as SELECT-then-UPDATE-by-id (`WHERE id IN (SELECT id ... stale predicate)`, so the outer statement does not re-check the predicate) | `RunReaperConcurrencySpec.scala:101` (heartbeat vs reap) and `:116` (reap vs reap): `1 was not equal to 0` |
| C | The heartbeat stamps nothing but reports success (`stampHeartbeatsInternal` = `Future.successful(runIds.size)`, which models the user-pool 0-row failure mode) | `LiveRunReaperSpec.scala:169`: `after 900 s of simulated run time: "[fail]ed" was not equal to "[queu]ed"` |
| D | Deregister only on `Success(Right(_))` | `LiveRunReaperSpec.scala:203` and `:245`: the tracker is non-empty after the reaped-late-success (Left), failure and blocked exits |
| F | Raw Retry-After (drop `math.max(1L, …)`) | `DatasetWriteAutoRunDroppedFireSpec.scala:346`: `(…00:03Z, None, 1) was not equal to (…00:04Z, None, 1)` |
| G | Remove `guard_retry_count = 0` from `upsertDebounce`'s `ON CONFLICT` | `DatasetWriteAutoRunDroppedFireSpec.scala:327`: `1 was not equal to 0` |

- The cycle-1 and cycle-2 evaluators already ran and recorded two more mutations: the unconditional terminal update and `afterTerminalWin`-always-runs (both red), plus the open-check move-after and ignore variants. I did not repeat them.

**AC1 red on main, reproduced by me.**
- Setup: a `git archive` of `849dd96c9`, plus `OrphanedRunReaperSpec`'s three AC1 cases verbatim. The fixture `PipelineSchedulerServiceFixture` is byte-identical between main and HEAD.
- Result: `failed=3`, all three are assertion failures (`"[queu]ed" was not equal to "[fail]ed"`, `OrphanedRunReaperSpec.scala:102/115/133`), and none are exceptions.
- Together with mutation A, this shows the orphan both survives and blocks on code without the reaper.

**AC by AC.**
- **AC1/AC2.** Covered by the `OrphanedRunReaperSpec` (a), (b) and (c) cases:
  - the spec drives only `tick()` and `FakeClock`;
  - the orphan is a raw-SQL insert that does not name `heartbeat_at`;
  - in (c), the orphan sits on a different pipeline of the same owner, with the cap of 3 filled.
  - Green at HEAD, red on main (above).
  - `PipelineSchedulerService.tick()` runs `orphanReaper.reap(now).flatMap(_ => runPasses(now))`. The reap is `recover`ed, so it never fails the tick.
- **AC3.** In `LiveRunReaperSpec` 4.2, a real `PipelineRunService` runs behind a Promise gate, with the clock advanced to 10x the bound. The run stays `queued` and ends `succeeded`. Mutation C proves the heartbeat is what keeps it alive.
- **AC4.** The `RunReaperConcurrencySpec` lock-wait proof:
  - the test confirms the reaper is blocked on B's pid via `pg_blocking_pids`;
  - after B commits, the reap returns 0 for both heartbeat-vs-reap and reap-vs-reap;
  - a control case reaps the run when B does nothing;
  - mutation B turns both blocked cases red.
- **First terminal write wins, on every terminal path:**
  - `updateRunTerminalInternal` filters on `completedAt.isEmpty` and returns Boolean. The owner path delegates to it.
  - The failure path (`PipelineRunTerminalWrites` ~:109), the write-back-failure path (~:194) and the blocked path (~:226) gate `writeLastRun` and `persistAssertions` behind `afterTerminalWin`.
  - The success chain checks `isRunOpenInternal` BEFORE `applyPendingWriteBacks` (`PipelineRunExecutor.onRunSuccess`). Its `updateMeta` and `assertionsInsert` are sequenced after `updateRun` and gated on the result.
  - Tests: `LiveRunReaperSpec` 4.4 (no snapshot, history or write-back dataset row; `last_run_status` stays failed), the failure and blocked late-outcome cases, and `OrphanedRunReaperSpec` 3.4.
  - The late finisher returns `Left(Conflict)`. `PipelineAutoRunDebounceFirer.submitAutoRun` maps that to `FireOutcome.Done` (no retry storm). Over HTTP it is a 409.
- **withSystemContext (code read; dev and CI are superuser).**
  - All four new statements run under `ctx.withSystemContext`, which is `privilegedDb.run` with the `helio_privileged` BYPASSRLS role (`DbContext.scala:63-64`): `stampHeartbeatsInternal`, `reapStaleRunsInternal`, `isRunOpenInternal` and `updateRunTerminalInternal`.
  - `updateRunTerminal` (owner) does its ownership lookup under user context and then delegates to the Internal variant, as before.
- **Every exit path deregisters.**
  - `PipelineRunExecutor`: registration happens only after the `Inserted` arm and retention. Then `Future.delegate(runAdmitted(...)).andThen { case _ => deregister }`, so a synchronous throw is covered too. The terminal writes are inside that future (`publishTerminalAfter` returns the writes' future).
  - Tests assert an empty tracker after the success, late-Left, failure and blocked exits. Mutation D proves the non-success exits are actually checked.
  - `SparkJobSubmitter` (dormant) deregisters in a `finally`.
- **Insert paths.** I checked every `pipeline_runs` insert:
  - `recordUnrunnable` finalizes its row immediately, so it is never live-and-untracked;
  - dry runs insert terminal rows and are untracked by design (`tracked = !isDry`);
  - no other non-terminal inserter exists besides the executor and the dormant Spark path.
- **AC5.**
  - (e) tests the 1 s floor through the cap pre-flight with `concurrencyRetryAfterSeconds = 0` (mutation F turns it red).
  - (f) sends three writes during one in-flight run: no run fires during it, exactly one after it completes, and none on a later tick.
  - (d) now resets the count while the row is still re-armed at count 1 (mutation G turns it red, so it is non-vacuous).
- **AC6.** The `Superseded` debug line now reads "claim token no longer matches (a fresh write re-armed the row, or another instance took over a stale claim)". The scaladoc for both `rearmAfterGuardRejection` and `RearmOutcome.Superseded` was updated to match.
- **AC7.**
  - After a fresh `git fetch`, `origin/main` = `849dd96c9`, whose highest migration is `V125__auto_run_debounce_guard_retry_count.sql`. HEAD adds only `V126__pipeline_runs_heartbeat.sql`, which is additive and nullable with no backfill.
  - The only other open feature PR, #969 (HEL-1503), adds no migration.
- **Spec.** `openspec/specs/pipeline-run-reaper/spec.md` traced requirement by requirement:
  - the WARN names the pipeline, run, owner and age;
  - the `failed` event goes out on the run service's own registry (`ApiRoutes.runRegistry`, wired in `Main`);
  - the env var falls back below 90 with a WARN (`PipelineRunGuardConfigStaleSpec`);
  - the legacy bound is 1 h, tested at 30 and 61 minutes;
  - `last_run_*` changes only when the reaped run is the latest real run (tested);
  - the heartbeat runs on its own `RunHeartbeatActor` timer, spawned in `Main` independently of the scheduler actor.
- **Commit hygiene.**
  - `b5476194e` and `15965b562` carry the `HEL-1511` prefix.
  - There are 0 `claude.ai` and 0 `Claude-Session` matches across all three branch commits.
- **Inline FQNs.** None. The only hit in added non-import lines is the scaladoc link `[[com.helio.app.RunHeartbeatActor]]`, which follows the existing scaladoc-link convention.
- **Not done, deliberately.** I did not start the branch's backend: V126 plus the reaper would act on the shared dev DB. There is no UI change, so step 4 is N/A.

### Verdict: CONFIRM

### Non-blocking notes
- The merge commit `191a3128c` has git's default subject ("Merge remote-tracking branch 'origin/main' …") and no `HEL-1511` prefix. The squash-merge folds it away. If the PR is merged any way other than squash, reword it first.
- PR #969 (HEL-1503) also edits `PipelineRunExecutor`, `PipelineRunSucceededWrites`, `PipelineRunService` and `PipelineRunRepository`, all of which this branch restructures. Whichever merges second must re-sync and re-run the reaper and late-finisher specs; resolve conflicts by intent (design.md Risks already notes this).
- `DbContext.withSystemContext` asks that "every callsite MUST carry an inline comment explaining why bypass is correct". `stampHeartbeatsInternal` explains it. `reapStaleRunsInternal` and `isRunOpenInternal` only imply it through their scaladoc (background job, no request-bound user). Worth one clause each.
- The AC1 red assertion stops at the orphan-status line on main, so on its own it shows "not reaped" rather than "blocks". Mutation A above (the orphan unreaped during the passes leads to `0 was not equal to 1` on all three blocking assertions) supplies the "blocks" half.
- The PR body still needs the read-only prod count query and the Q5 "Behaviour changes / data effects" note (owner ruling Q5 A is an approved prod-data change).
