## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `e6e0f3fd5c7c6a0bec7c0d77cf800dc5111d5480` (single commit on `bug/orphaned-run-reaper/hel-1511`).
Diff base: `2e02b79511fab222ac2bc73a142fc61e0979f192`, resolved live with `resolve-review-base.sh`. It equals `origin/main` after a fresh fetch, so the branch is current.
Scope: items 1, 2 and 4. Item 3 (the repository split) is out of scope and was not done (C3 honored).

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1 red first | PASS. `hel1511-red-first.txt` shows 3 assertion failures (`"[queu]ed" was not equal to "[fail]ed"`), not exceptions. The orphan is a raw-SQL row that does not name `heartbeat_at`. Case (c)'s orphan is on a different pipeline of the same owner. |
| AC2 reaped and green | PASS. The orphan becomes `failed`. On the same tick, the auto-run fires (a), the schedule fires (b) and the cap slot frees (c). Reaping happens at the top of `tick()`, before `runPasses`. |
| AC3 live run never reaped | PASS. `LiveRunReaperSpec` 4.2 advances the clock to 10x the bound in 300 s steps with `stampOnce` between ticks, and the run then finishes `succeeded`. The skip-register mutation goes red (stamp count 0). |
| AC4 multi-instance | PASS. `RunReaperConcurrencySpec` holds an uncommitted writer on connection B and confirms the reaper is lock-blocked on B's pid via `pg_blocking_pids`. After B commits the reaper returns 0, for both heartbeat-vs-reap and reap-vs-reap. A control case reaps the run when B does nothing. The SELECT-then-UPDATE-by-id mutation goes red on both cases. |
| AC5 item 2 | PASS. (e) checks the Retry-After floor (`max(1L, …)` removal goes red). (f) sends three writes during one in-flight run and gets exactly one follow-up run. (d) now ends with a fresh write while the row is still re-armed at count 1, and asserts the count resets to 0 (reset removal goes red). |
| AC6 item 4 | PASS. The DEBUG line and both scaladocs now name both causes: a fresh write, or another instance taking over a stale claim. |
| AC7 V126 | PASS. After a fresh fetch, origin/main's highest migration is V125. No ref in `git log --all` and no sibling worktree (HEL-1503, 1512, 1514) has a V126. |
| Spec requirement "First terminal write wins" | **FAIL.** Implemented, but no test proves it. Task 3.4 says "Verify with test 4.4", but 4.4 never reaches the conditional terminal write: the open-check returns `Left` before the write. See Change Request 1. |
| Tasks match implementation | Yes, apart from the 3.4 verification claim above. |
| Scope creep | None. |
| Constraints C1/C2/C3 | C1: honored (see Non-blocking item 2 on the `Thread.sleep(25)` poll). C2: honored. There are no inline FQNs (`npm run check:scala-quality` is clean; the only `[[com.helio…]]` hit in the diff is a scaladoc link, as at 34 existing sites). The commit message has the `HEL-1511` prefix, no claude.ai session link and no `Claude-Session` trailer. C3: honored. |
| CLAUDE.md env row | Present and accurate: default 600, floor 90 with WARN, the 1 h legacy bound, the error text and first terminal write wins. Prettier is clean. |
| files-modified.md | PASS. Bulleted, backticked, repo-relative, no braces. It lists all 24 non-openspec files in the diff and nothing extra. |

### Phase 2: Code Review — FAIL

**Gates (my own fresh run):**
- I ran `nice -n 19 sbt testFull` in WORKTREE_PATH at e6e0f3fd5. The summary was `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Total number of tests run: 7344`, `Suites: completed 554, aborted 0`, `Tests: succeeded 7344, failed 0, canceled 4`, `exit=0`. Before starting I checked there were 0 testFull runs and 51 GB MemAvailable. No sbt server was left running afterwards.
- `npm run check:scala-quality` is clean (soft-budget warnings only). `check-openspec-hygiene` and `check-spec-structure` are clean.
- There is no frontend change, so the frontend gates do not apply.

**Things I verified by reading the code, as instructed:**
- `stampHeartbeatsInternal` (PipelineRunRepository.scala:312), `reapStaleRunsInternal` (:327) and `isRunOpenInternal` (:306) all run under `ctx.withSystemContext`. That is `privilegedDb.run(action.transactionally)` (DbContext.scala:63-64), so the RLS user pool cannot match 0 rows in prod.
- **Every exit path deregisters.** `PipelineRunExecutor.scala:423-426` registers only after the `Inserted` arm and the retention step. It wraps the whole `runAdmitted` (engine plus every terminal chain) in `Future.delegate(...).andThen(deregister)`, so a synchronous throw becomes a failed Future and is still covered. `publishTerminalAfter` returns the writes' Future, so deregistration happens after the terminal writes. Paths that end before admission never register, so they cannot leak. `SparkJobSubmitter` (dormant) registers after insert and deregisters in a `finally` inside its `Future`. Tests assert `liveRunTracker.snapshot() shouldBe empty` after both 4.2 and 4.4.
- The registry is the same instance end to end. `ApiRoutes.runRegistry` (:331) is passed to `PipelineRunService` (:447), and Main passes it to the scheduler (:307).

**Judgments on the executor's reported deviations:**
1. **error_log uses the real silent seconds:** accepted. The ruling's text says "no heartbeat for N s", and the measured silence is the most truthful N. It is computed in SQL, and the 660 s case asserts the exact string.
2. **truncated_reads is `EmptyTruncationJson`, not `[]`:** accepted, and it fixes an error in the design. `EmptyTruncationJson = {"primaryAvailableRowCount":null,"reads":[]}` (PipelineRunService.scala:339) is what every existing failed path writes (PipelineRunTerminalWrites.scala:111/196/229). A literal `[]` would have created a second, inconsistent failed-row shape.
3. **Success-chain last_run/assertions sequenced after the terminal write:** accepted. The spec says a late outcome SHALL NOT overwrite `last_run_*`. Gating these writes on the terminal write's Boolean is the only way to honor that inside the window between the open-check and the terminal write. It matches what D4 asked of the failure, blocked and write-back paths. The cost is that two writes which used to run in parallel now run one after the other.
4. **executeRun refactored into runAdmitted/unblockedChain:** accepted. The diff moves code verbatim (publish queued/running, `onNodeProgress`, engine call, `transformWith`; the write-back `recoverWith` chain). The only change in behavior is the intended register/deregister wrapper and the open-check.
5. **`ApiRoutes.runRegistry` is now public:** accepted. It is the smallest change that lets Main hand the scheduler the same registry. It carries a comment explaining why. It exposes nothing new over HTTP.
6. **Mutation 4.4 used only the removal variant:** accepted, after I ran the other variants myself. The executor's removal mutation goes red at `await(submitted).isLeft` (LiveRunReaperSpec.scala:191), which only proves the return type. So in a throwaway detached worktree at e6e0f3fd5 (since removed) I ran:
   - **Move-after** (write-backs applied before the open-check): red at the write-back assertion. Output: `2 was not equal to 0 (LiveRunReaperSpec.scala:198)`, `failed=2`.
   - **Check ignored** (the false branch runs `unblockedChain` and still returns `Left`): red at the snapshot assertion. Output: `2 was not equal to 0 (LiveRunReaperSpec.scala:196)`, `failed=1`.

   So the data assertions in 4.4 can fail; the test is not vacuous.

**Finding: the conditional terminal update survives mutation (blocking).**
- I mutated `updateRunTerminalInternal`'s filter from `r.id === runId.value && r.completedAt.isEmpty` back to `r.id === runId.value`, at PipelineRunRepository.scala:299 in a scratch copy.
- Run 1: `LiveRunReaperSpec`, `OrphanedRunReaperSpec`, `RunReaperConcurrencySpec` and `com.helio.infrastructure.persistence.pipelines.*`. Result: `Tests: succeeded 246, failed 0`.
- Run 2: `PipelineRunServiceSpec`, `PipelineRunGuardIntegrationSpec`, `PipelineRunRoutesSpec`, `OutputRoutesSpec`, `PipelineRunServiceTerminalOrderingSpec` and `DatasetWriteAutoRunDroppedFireSpec`. Result: `Tests: succeeded 271, failed 0`.
- Together that is 517 tests, every spec that references `updateRunTerminal*`, with no red.
- The `afterTerminalWin(..., won = false)` branch (PipelineRunTerminalWrites.scala:57-65 (`afterTerminalWin` at :59)) also has no test reaching it. That branch is how the failure path, the blocked path, the write-back-failure path and the success-window path skip `last_run_*` and assertion writes.
- So D4 / Q6 A ("first terminal write wins") is implemented but not proven. It is the only protection for a reaped run whose engine then **fails** or is **blocked**: those paths never consult `isRunOpenInternal`.

**Other checklist items:**
- **DRY, readable, modular:** OK. `OrphanedRunReaper` and `RunHeartbeatService` are small and focused. `afterTerminalWin` removes the repeated skip logic.
- **Type safety and security:** OK. The reap uses bound parameters in Slick's `sql` interpolator, and there is no user input.
- **Error handling:** OK. `reap` recovers and logs at ERROR, so it never fails the tick. A heartbeat failure is logged and re-armed.
- **Dead code:** none.
- **Over-engineering:** none. There is no advisory lock and no instance table.

### Phase 3: UI Review — N/A

- No `frontend/**`, `schemas/**` or `openspec/specs/**` file changed.
- The only `ApiRoutes.scala` change is a `private val` becoming a `val`. No route, payload or status code changes.
- The only user-visible effect is a `failed` `RunStatusEvent`, which reuses an existing event shape the editor already handles.
- I deliberately did not start dev servers. Starting this branch's backend would apply V126 to the **shared** dev database, and its reaper would then mark other lanes' old non-terminal dev rows `failed` (MISTAKES / shared-dev-DB hazard). The orchestrator should weigh that before any later live probe of this branch.

### Overall: FAIL

### Change Requests
1. **Prove "first terminal write wins" (spec requirement, design D4, Q6 A) with tests that fail under mutation.** Add the following, for example to `LiveRunReaperSpec` and `PipelineRunRepositorySpec`:
   - (a) **Repository level.** Seed a run, finalize it with `reapStaleRunsInternal` (or a terminal update), then call `updateRunTerminalInternal(... "succeeded" ...)` and `updateRunTerminal(... owner ...)`. Assert both return `false` and that `status`, `error_log` and `completed_at` are unchanged.
   - (b) **Service level, failure path.** Use the `LiveRunReaperSpec` gate, reap the run, then release the gate with a failing engine (`gate.failure(...)`, or a delegate that throws). Assert:
     - the row's `error_log` still contains `Run abandoned`;
     - `pipelines.last_run_at` still equals the reaper's `now`, not a later `Instant.now()`;
     - no `pipeline_run_assertions` rows exist for that run.
   - (c) **Service level, blocked path** (optional but cheap). A pipeline with an `error`-severity failing assert step, reaped while gated, then released. Assert the same three things.
   - (d) **Record mutations in the evidence dir.** Remove `&& r.completedAt.isEmpty` from `updateRunTerminalInternal` (PipelineRunRepository.scala:299), and separately make `afterTerminalWin` always run `work` (PipelineRunTerminalWrites.scala:59-65). Each must go red.
   - (e) **Fix task 3.4's verification note,** which currently names 4.4.

### Non-blocking Suggestions
1. When `updateRunTerminal` (owner path, PipelineRunRepository.scala:279) gets `None` from the ownership query, it now returns `false`. `afterTerminalWin` then logs "reaped as abandoned", which is misleading for a pipeline deleted mid-run. Consider a neutral wording such as "already terminal or no longer owned".
2. `RunReaperConcurrencySpec.awaitBlockedBy` polls with `Thread.sleep(25)`. It is a bounded wait for a condition, not a timing assumption, so it is within design R2. C1 says "no sleeps", so the orchestrator may want to confirm it accepts this.
3. On the `PipelineRunExecutor.scala:340` late-finisher WARN, consider also logging the run's age, to match the reaper's WARN.
4. PR body: carry the read-only prod count query and the "Behaviour changes / data effects" note from the design's Migration Plan (owner ruling Q5).

### Evidence (self-authenticating extracts from my own runs)
- **testFull** (WORKTREE_PATH, e6e0f3fd5): `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, then `Total number of tests run: 7344`, `Tests: succeeded 7344, failed 0, canceled 4`, `All tests passed.`, `exit=0`.
- **Mutation, move-after:** `should stay failed and write no snapshot, history or write-back row when it finally finishes *** FAILED ***`, `2 was not equal to 0 (LiveRunReaperSpec.scala:198)`, `[hel1468-guard] ScalaTest summary: failed=2`.
- **Mutation, check ignored:** `2 was not equal to 0 (LiveRunReaperSpec.scala:196)`, `[hel1468-guard] ScalaTest summary: failed=1`.
- **Mutation, unconditional terminal update:** `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 246, failed 0` and `Tests: succeeded 271, failed 0`. The mutation survived.
