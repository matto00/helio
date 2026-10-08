## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `290e1edf9e53cf341d4234c957acd4b2342c0011`. Diff base resolved live via
`resolve-review-base.sh`: `b14e622ee325c32569a452b6d9a8eb1d826ca76b`.

### Fresh evidence (my own runs, not the executor's report)

- `cd backend && nice -n 19 sbt testFull` in WORKTREE_PATH: **6104 succeeded, 0 failed, 4 canceled**.
  The 4 canceled are the existing opt-in `HELIO_MEASURE=1` / latency report-only cases, the same as on main.
- `npm run check:scala-quality`: clean (soft size warnings only). `npm run check:openspec`: clean.
  Prettier on the change dir: clean.
- **Red-first re-verification (C2).** I extracted HEAD's `backend/` into a scratch dir (not this worktree)
  and replaced only `PipelineRunService.scala` with b14e622ee's version. I then ran
  `testOnly PipelineRunServiceTerminalOrderingSpec`: 7 passed, and all 3 new HEL-1370 cases failed for the
  expected reasons:
  - rate limit: `Vector(RunStatusEvent("queued", ...)) was not empty` (:562)
  - concurrency cap: the subscriber saw a second run id's `queued` (:583)
  - write-back exception: `no terminal event arrived ... events=Vector(queued, running, node-progress, node-progress)`

  This matches `red-run-evidence.txt`. **C2 is confirmed.**
- **D3 probe (load-bearing for the Phase 1/2 finding below).** I ran two more scratch copies of HEAD's
  `backend/`, each with one extra test case, `EVAL-LOCK`. It is the HEL-1370 write-back-exception setup
  (the same `withFailingDatasetRowInsert` trigger), driven through `startAndLockRunRow`. It then follows
  `finishFailedCase`'s lock steps: `awaitBlockedBy`, `assertNoTerminalWhileBlocked`, non-terminal status
  while the lock is held, then release.
  - **Copy C** (HEAD's service, unmodified, plus EVAL-LOCK): **11/11 green**. The lock variant works
    against the real fix. I saw nothing that makes it infeasible.
  - **Copy B** (HEAD's service with one mutation in the new `recoverWith` branch, plus EVAL-LOCK). The
    mutation publishes `failed` *before* doing the `updateRunTerminal`/`updateLastRun` writes, then
    re-fails with `ex`. Result: **the executor's write-back-exception case PASSED**, and only EVAL-LOCK
    failed: `terminal event received while write blocked (pipeline_runs row locked)`.
  - Against base (copy A), EVAL-LOCK is also red (its lock never blocked a service backend, because on
    base no terminal write happens at all).

### Phase 1: Spec Review — FAIL

- AC1 (both paths confirmed against the code): PASS. The design's Context section cites the guard order
  and the `applyWriteBacks` recovery scope. I checked both against b14e622ee.
- AC2 (a 429 never leaves a `queued` without a terminal event): PASS. `queued` moved into
  `preExec.flatMap`'s `Right(())` branch (PipelineRunService.scala:1079-1080). This is reached only after
  the rate limit and, for a real run, the cap insert has returned `Inserted`/`NotOwned`. A guard-failed
  Future also publishes nothing.
- AC3 (a write-back Future failure publishes exactly one terminal event): PASS on behavior.
  - The new `recoverWith` (:1308-1316) wraps only `applyPendingWriteBacks` and routes through
    `onWriteBackFailure` → `publishTerminalAfter`.
  - The `transformWith(_ => Future.failed(ex))` re-fail propagates out of the `Success` branch of
    `runFuture.transformWith`, so `executeRunFailure` never runs. There is no double publish, and the
    witness-bus count confirms this.
- AC4 (each case has a test that fails before the fix): PASS (re-verified above).
- **Design D3 / spec scenario not met by the test (FAIL).**
  - D3 asks for the write-back-exception case to show `failed` is published "after the run's `failed`
    status is durable (row-lock ordering as in `finishFailedCase`)".
  - The delta scenario says "exactly one `failed` RunStatusEvent is published after that row is
    durable" (`specs/pipeline-run-execution/spec.md`) and "the run's record is persisted as `failed`,
    and then exactly one `failed` event is published" (`specs/pipeline-run-sse/spec.md`).
  - The shipped case (PipelineRunServiceTerminalOrderingSpec.scala, the third HEL-1370 case) only reads
    `pipeline_runs.status` after the event arrives. That check is timing-based. The spec class's own
    header (lines 36-45) rules out timing-based checks: "Deterministic, lock-holding proof ... never
    timing-based".
  - My copy-B mutation shows the gap concretely. A publish-before-write regression in exactly the new
    branch passes the shipped test and is caught only by the lock variant.
  - The ordering *behavior* is correct today, because the branch reuses `onWriteBackFailure`. But the
    scenario's ordering clause has no test that would catch a regression in the new code path.
- **The deviation is undocumented.** The orchestrator said the executor's rationale for omitting the lock
  variant is in `files-modified.md`. That file (3 lines) contains no such rationale, and no artifact
  records the deviation. Either way, the lock variant is feasible (copy C is green), so I could not find
  a reason to accept the omission.
- Scope, regressions: no scope creep. `PipelineRunRoutesSpec`, `PipelineRunGuardIntegrationSpec` and the
  write-back specs pass inside testFull. No API/schema change, as the design says.
- Tasks: all checked. Task 2.4 ("after durable failed status") is marked done but is satisfied only
  weakly; see above.
- CONSTRAINTS: C1 holds (17-line main-source diff: one import, the moved publish, one `recoverWith`; no
  refactor). C2 holds (re-verified). C3 holds for my own runs (nice -n 19, at most 3 concurrent sbt
  processes).

### Phase 2: Code Review — FAIL

- Gates: sbt testFull is green. Scala quality is clean: no inline FQNs, and `NonFatal` and
  `scala.util.{Failure, Success}` are top-level imports. `PipelineRunService.scala` is 1764 lines, far
  over the soft budget, but C1 forbids splitting it here and HEL-1371 owns the split. That is accepted.
- Production code:
  - Correct and minimal. `Future.unit.flatMap(_ => ...)` also catches a synchronous throw. The raw cause
    is logged via `log.error(..., ex)`, and the client-visible `errorLog` is generic (HEL-311).
  - The re-fail always surfaces the original `ex`, even if the bookkeeping fails (`transformWith`, not
    `flatMap`), as D2 specifies.
  - No dead code. The comments are accurate.
- Tests:
  - The two 429 cases are meaningful.
    - The rate-limit case has a non-vacuity probe: a direct `registry.publish` still reaches the open
      subscriber.
    - The concurrency-cap case checks that run A's own terminal event still arrives.
    - Both use a 500 ms sleep as their quiet window. This is acceptable because on base the `queued`
      publish is synchronous before `submit` returns. The red run proves the window is long enough.
  - The write-back-exception case does not deterministically prove ordering (Change Request 1).

### Phase 3: UI Review — N/A

Backend-only diff (`backend/src/**` and the openspec change dir). It touches no `frontend/**`,
`ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` files.

### Overall: FAIL

### Change Requests

1. **Add the D3 row-lock ordering proof for the write-back-exception path**
   (`backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceTerminalOrderingSpec.scala`).
   Either convert the existing third HEL-1370 case or add a sibling. Inside
   `withFailingDatasetRowInsert(targetId) { ... }`:
   - Start the run with `startAndLockRunRow(h, fx)` (call `observerPid` first). Then `h.gate.success(())`,
     `awaitBlockedBy(rowLock, Set(observerPid, rowLock.pid))`,
     `assertNoTerminalWhileBlocked(h.sub, "pipeline_runs row locked")`, and assert the run status is
     non-terminal.
   - Then `rowLock.release()`, `awaitTerminal()`, and the existing assertions: `failed`, `errorLog`
     includes `upsertsource`, run and `last_run_status` are `failed`, `awaitCompleted(submitted)`, the
     submit Future is a `Failure`, and `assertExactlyOneTerminalPublished(h, "failed")`.
   - Do not call `finishFailedCase` directly: its `await(submitted)` throws on the intentionally failed
     Future. Inline its steps, or give it a flag to expect a failed submit.
   - I ran exactly this shape: green on HEAD, red on b14e622ee, and red on a publish-before-write
     mutation of the new branch, which the current test misses.
   - Record its red run alongside the existing evidence (C2).
2. **Record the D3 decision in the change artifacts.** If you adopt CR1, update `files-modified.md` to
   list the lock-ordered case. Do not leave a claimed rationale that no artifact actually contains.

### Non-blocking Suggestions

- In the write-back-exception case, also assert that `ev.errorLog` does not contain the trigger's raw
  message (`"hel1370 test"`). The `pipeline-run-sse` delta scenario promises the event carries `errorLog`
  "without exposing the raw exception", and nothing currently checks that clause.
