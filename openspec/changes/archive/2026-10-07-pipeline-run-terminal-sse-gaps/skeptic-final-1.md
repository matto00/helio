## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `14d13a10c9b7e6712d9fb3856f021eef52bd3d4d`. Diff base resolved live through
`resolve-review-base.sh` (exit 0): `b14e622ee325c32569a452b6d9a8eb1d826ca76b`. Spawn-cwd guard: `READY`.

### What I verified (with evidence)

**Root cause (systematic-debugging law), confirmed in the code myself**
- Path 1: on b14e622ee, `executeRun` publishes `queued` before `rateLimitCheck` and
  `insertRunIfUnderConcurrencyCap`. Both reject with `Future.successful(Left(TooManyRequests))` and publish
  nothing after that.
- Path 2: `DataSourceRepository.applyWriteBacks` (`persistence/sources/DataSourceRepository.scala`) only does
  `.recover { case e: IllegalStateException => Left(...) }`. Any other DB error is a failed Future.
  - On base, `onRunSuccess`'s `applyPendingWriteBacks(...).flatMap { Left | Right }` skips both branches.
  - So there is no terminal event, and the run row stays non-terminal.
- `executeRun`'s `runFuture.transformWith` sends Success to `executeRunSuccess` only. A failed
  `onRunSuccess` is never re-routed to `executeRunFailure`, so the new recovery cannot double-publish.

**C1: the PipelineRunService.scala diff is minimal**
- `git diff b14e622ee...HEAD -- backend/src/main`: 1 file changed, +15/-2.
- The changes are:
  - the `NonFatal` import
  - the `queued` publish moved, plus comments
  - the `recoverWith` around the write-back call only
- No renames, extractions or refactors.

**D1: the `queued` publish moved, and nothing is published for a guard-rejected submit**
- `queued` is now published at line 1080, directly before `running`, inside `preExec.flatMap`'s `Right(())`
  branch.
- That point is reached only after the rate limit passes and, for a real run, after
  `Inserted`/`NotOwned`.
- The `Left(err)` branches publish nothing.
- `grep 'RunStatusEvent("queued"'` across `backend/src/main` finds exactly one site.
- No synthetic terminal event was added, as the design specifies.

**D2: a failed write-back Future goes to `onWriteBackFailure`, then re-fails with the original exception**
- The wrapper is
  `Future.unit.flatMap(_ => applyPendingWriteBacks(...)).recoverWith { case NonFatal(ex) => log.error(..., ex); onWriteBackFailure(..., "Step (upsertsource): write-back failed").transformWith(_ => Future.failed(ex)) }`.
  It sits before the downstream `.flatMap { Left | Right }`.
- What this gives:
  - A synchronous throw is also captured.
  - Only the write-back call is wrapped.
  - The original `ex` is re-raised whatever `onWriteBackFailure` returns.
  - The failed Future skips the downstream flatMap, so `onWriteBackFailure` is not called a second time.
- `onWriteBackFailure` → `publishTerminalAfter` publishes exactly once, after its writes, whether they succeed
  or fail.

**C2: red first against b14e622ee**
- I re-ran this myself in a fresh `git archive HEAD` scratch copy with only b14e622ee's
  `PipelineRunService.scala` swapped in. `nice -n 19`; at most 3 sbt processes.
- Result: 7 passed, 3 failed. All three failures are the HEL-1370 cases:
  - Rate limit: `Vector(RunStatusEvent("queued", ...)) was not empty`.
  - Concurrency cap: the subscriber sees a second run id's `queued`.
  - Write-back: `lock 'pipeline_runs row' ... never blocked a service backend`.
- What the write-back red shows: on base, no terminal write is ever attempted. That is the durable half of the
  bug.
- The SSE half ("no terminal event arrived", events end at node-progress) is in the cycle-1
  `red-run-evidence.txt`.
- Both match the executor's `red-run-evidence*.txt`.

**My own mutation, not the evaluator's: a half-fix**
- The mutation publishes `queued` after the rate limit but before the concurrency cap.
- Result: 9 passed, 1 failed. Only the concurrency-cap case failed, with the subscriber seeing two run ids.
- So the concurrency case independently pins the *position* of the moved publish, not just "after the rate
  limit".

**Green at HEAD (fresh scratch copy)**
- `PipelineRunServiceTerminalOrderingSpec`: 10/10, exit 0.
- `PipelineRunRoutesSpec`, `ApiRoutesPipelineRunGuardSpec`, `PipelineRunGuardIntegrationSpec`,
  `DataSourceRepositoryApplyWriteBacksSpec` and the ordering spec together: 80 succeeded, 0 failed, 5 suites,
  exit 0.
- Full-suite `sbt testFull`: I rely on the evaluator's pasted result in `evaluation-2.md` (6104/0/4 canceled
  opt-in at this exact SHA). Cycle 2 touched tests only, and my targeted runs agree with it.

**Acceptance criteria traced**
1. Both paths confirmed against the code: see the root-cause section above (my own reading of b14e622ee).
2. A 429 never leaves a `queued` without a terminal event: the D1 move. Tested by the rate-limit case
   (limit 0) and the concurrency-cap case, red on base and green at HEAD. The rate-limit case is non-vacuous:
   the subscriber stays open and receives a later probe event.
3. A failed `applyWriteBacks` Future publishes exactly one terminal event: D2.
   - Tested with a real SQL error from a test-only `BEFORE INSERT` trigger.
   - The row lock proves the ordering.
   - `assertExactlyOneTerminalPublished(h, "failed")`, the durable `failed` row and `last_run_status`, an
     `errorLog` that names upsertsource and does not leak the raw SQL, and a submit Future that still fails.
4. Each case has a test that fails before the fix: yes, all three, reproduced.

**Spec deltas match the code**
- Both deltas are `MODIFIED` and carry the full requirement text. I diffed each against
  `openspec/specs/<cap>/spec.md`:
  - every original scenario is kept
  - only the `queued` wording changed
  - the two new scenarios and the write-back-exception sentence were added
- `pipeline-run-sse`: "`queued` once admitted… guard-rejected publishes no event at all… write-back exception →
  exactly one `failed`, errorLog names upsertsource without raw exception". This matches lines 1080 and
  1308-1316, and the tests.
- `pipeline-run-execution`: same `queued`-on-admission wording, plus "write-back exception → row `failed` with
  error_log naming upsertsource". This matches `onWriteBackFailure`'s `updateRunTerminal("failed", errorLog =
  "Step (upsertsource): write-back failed")`.

**Frontend impact**
- No frontend diff.
- The consumers `usePipelineRunEvents` and `PipelineDetailFooter` only care about order, and the order
  `queued` → `running` is unchanged.
- No UI review needed. Step 4 skipped: no `frontend/**` changes.

### Verdict: CONFIRM

### Non-blocking notes
- D2's "re-fail with the ORIGINAL exception even if `onWriteBackFailure`'s writes fail" is only proven by
  reading the code (`transformWith(_ => Future.failed(ex))`). The test asserts only `Failure(_)`, so swapping
  in `flatMap` (which would surface the secondary error) would still pass. The code is correct as written, so
  this is not blocking. HEL-1371 could add an identity assertion
  (`Failure(e) => e.getMessage should include("hel1370 test")`).
- The write-back case's base red message ("never blocked a service backend -- the case would be vacuous") is
  indirect. The evaluator suggested a clearer message, and I agree it is optional.
- Disclosure: my first attempt to set up a scratch copy ran in the shared session scratchpad. `rsync` is not
  installed, so the copy failed, but the `git show`/python steps in the same command still overwrote
  `PipelineRunService.scala` in pre-existing `scratchpad/base/` and `scratchpad/mut/` dirs left by a prior
  agent.
  - Nothing in the worktree or the repo was touched.
  - All the evidence above comes from my own fresh `git archive` copies under `scratchpad/skf1370/`.
  - Any later reuse of `scratchpad/base` or `scratchpad/mut` should treat them as modified.
