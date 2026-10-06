## Context

`SparkJobSubmitter.submit` (backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala) inserts a `running` run
row synchronously, returns the run id, then in a background `Future { blocking { ... } }` on `sparkEc`:

1. `cache.update(runIdStr, Succeeded|Failed, ...)` -- synchronous, in-memory;
2. `pipelineRepo.updateLastRunInternal(...)` -- returns `Future[Unit]`, **not awaited** (lines 85 / 109);
3. `pipelineRunRepo.updateRunTerminalInternal(...)` -- returns `Future[Unit]`, **not awaited** (lines 93 / 113).

Steps 2 and 3 are *issued* in that order but are fire-and-forget Slick actions on the DB context's executor, so their
*commit* order is not guaranteed. The two `submit` tests in `SparkJobSubmitterSpec` (lines ~372-430) then
`Thread.sleep(3000)` and assert on (a) `findByIdInternal(pid).lastRunStatus`, (b) `listByPipeline(pid, owner)` --
size, status, rowCount, errorLog -- and (failure test) (c) the in-memory cache entry.

## Goals / Non-Goals

**Goals:** remove the fixed sleeps; wait on exactly the persisted state the assertions read; bounded; assertions
unchanged; mutation-proven.

**Non-Goals:** any product-code change (write order, awaiting the writes) -- follow-up only.

## Decisions

**Decision 1 -- poll the run record via the same read the assertions use.** Poll
`pipelineRunRepoForSubmit.listByPipeline(PipelineId(pid), AuthenticatedUser(owner))` until some row's `status` is
`RunStatus.Succeeded` or `RunStatus.Failed`. Same query and user as the assertions, so the poll observes what they
will. Alternative `listByPipelineInternal`: rejected -- a different (system-context) read than the assertions.

**Decision 2 -- the predicate is a conjunction: run row terminal AND `lastRunStatus` defined.** Because the two writes
are un-awaited (Context), observing the run row terminal does NOT prove the `pipelines` update has committed; a
run-record-only poll would just move HEL-1287's race to the other assertion. The poll therefore also requires
`findByIdInternal(pid).flatMap(_.lastRunStatus).isDefined`. It checks *defined*, not the expected value, so the poll
never encodes the assertion -- a wrong value still fails on the unchanged assertion, not as a poll timeout. The cache
(written synchronously before both) needs no poll term.

**Decision 3 -- mechanism: ScalaTest `Eventually` with explicit patience.** A private helper
`awaitRunPersisted(pid: String): Unit` built on `org.scalatest.concurrent.Eventually.eventually` with
`timeout(30.seconds)` (matching the spec's existing `await` bound) and `interval(50.millis)`. Already used in this repo
(e.g. `PipelineRunRegistrySpec`, `OutputRoutesSpec`). On expiry it throws `TestFailedDueToTimeoutException` -- a
loud, bounded failure. Alternative hand-rolled deadline loop: rejected, more code for the same behavior. Each probe
uses the spec's own `await` (30 s per DB call; a hung DB still fails, just slower).

**Decision 4 -- mutation proof (temporary edits, reverted, never committed).** Run only the two `submit` tests
(`testOnly com.helio.spark.SparkJobSubmitterSpec`) in these configurations and record pass/fail + the failing line:
- M0 baseline: unmutated product code, new poll -> green.
- M1 (ticket's mutation): `Thread.sleep(2000)` between the `updateLastRunInternal` call and the
  `updateRunTerminalInternal` call, on both success and failure paths.
  - with a reconstructed HEL-1287-style poll (wait until `lastRunStatus` is defined; that change never landed in git,
    so the reconstruction is stated as such) -> RED on the run-row assertion (`running` vs expected);
  - with the new poll -> GREEN.
- M2 (proves Decision 2's conjunct): swap the two calls and put the `Thread.sleep(2000)` between them (run terminal
  first, `lastRunStatus` late):
  - with a run-record-only poll (Decision 2 conjunct removed) -> RED on the `lastRunStatus` assertion;
  - with the new poll -> GREEN.
The product file is restored with `git checkout --` and `git diff --stat` on `backend/src/main` is shown empty.

**Decision 5 -- timing measurement.** Time the spec before (main's sleeps) and after (new poll) with
`sbt "testOnly com.helio.spark.SparkJobSubmitterSpec"` reported per-test durations, same machine, back-to-back,
reporting both per-test durations and the delta. Expected saving is ~6 s minus the jobs' real latency.

## Risks / Trade-offs

- [Slow CI runner makes the Spark job exceed 30 s] -> same bound as the spec's existing `await`; failure is explicit.
- [Poll interval adds DB load] -> 50 ms on an embedded Postgres for at most a few seconds; negligible.
- [Mutation is a manual, unrecorded-in-git step] -> both red and green outputs are captured verbatim in the executor's
  evidence and the PR body.

## Planner Notes

- Self-approved: predicate strengthened beyond the ticket's literal "poll the run record" (Decision 2). It still polls
  the run record; it adds the second write the unchanged assertions depend on. Not a scope change.
- Follow-up (note only, do not file): `SparkJobSubmitter.submit` fires both terminal writes without awaiting or
  sequencing them, so write *order* in source is not commit order, and a failed write is silently dropped. The path is
  dormant (HEL-202), so this is low-priority.
- Test runs: `nice -n 19`, `HEL924_TEST_GROUP_CONCURRENCY=2`, Bash timeout 600000, EmbeddedPostgres only.
