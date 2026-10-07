## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `d5ec9a8294dbc150cbed6e0bfa7fda55845f9b0d`. Diff base, resolved live: `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`. The cycle delta is `e075255de..d5ec9a829`: `PipelineRunService.scala`, the ordering spec, files-modified.md, and evaluation-1.md, which the executor committed.

My evidence is copied to `/home/matt/Development/helio/.concertino/runs/HEL-1366/evidence/evaluator-cycle2/`. Every claim below rests on file content, not on mtimes.

| File | What it shows |
|---|---|
| `eval2-testFull.log` | `sbt testFull` at d5ec9a829: 6092 succeeded, 0 failed, 4 canceled, exit 0 |
| `eval2-mutant-C1.log` | My cycle-1 mutant (`flatMap` plus double publish), run against the new spec: 7/7 FAILED |
| `eval2-mutant-M1.log` | Split mutant, `flatMap` only (no publish when the write fails): 5 passed, 2 FAILED (exactly the two trigger cases) |
| `eval2-mutant-M2.log` | Split mutant, double publish only (`transformWith` kept): 7/7 FAILED, all through the witness counter (`published terminal events: Vector(x, x)`) |
| `eval2-green-{1,2,3}.log` | Spec on the real code, three repeats: 7/7 passed each time, and 7 tests actually ran each time (no sbt-cache zero-run) |
| `eval2-red-base.log` + `eval2-hang-diagnosis.txt` | The new spec against the pre-fix base `PipelineRunService.scala`. This run hung; see Phase 2 issue 1 |

All mutant and base runs used one throwaway detached worktree at d5ec9a829. I removed it with `git worktree remove --force` on its exact path; `git worktree list` shows no straggler.

### Phase 1: Spec Review — PASS
- **CR1 (D2 "exactly one" can now fail): verified.** The service registry now publishes through a real `PipelineRunNotifyBus`. A second, independent witness bus counts terminal events per pipeline at publish level, so subscriber removal no longer hides a duplicate. The M2 mutant kills all 7 cases through this counter.
- **CR2 (published even when a terminal write fails): verified.** Two trigger cases cover this: `failed` from an execution exception, and `succeeded`. The M1 mutant (no publish on failure) kills exactly these two, which proves they really drive the failure branch of `publishTerminalAfter`. In both cases the run is also confirmed left non-terminal, which shows the terminal write really failed.
- **CR3: verified independently.** The executor's 7/7-red claim holds against my cycle-1 mutant. The split mutants above show that each guard is red-able on its own.
- **Non-blocking item from cycle 1 (synchronous-throw publish): done.** `publishTerminalAfter` now takes `writes: => Future[T]` and starts it inside `Future.unit.flatMap`. All five sites build their chains in a local `def` and pass the call by name. The `-w` diff shows no behaviour change beyond moving each chain's construction inside the wrapper; the `Instant.now()` capture moves by microseconds. Events and their content are unchanged.
- All ACs remain met, as established in cycle 1. Constraints C1–C6 are honoured.

### Phase 2: Code Review — FAIL

Gates I ran myself:
- `sbt testFull`: 6092 passed, 0 failed.
- `npm run lint`: exit 0.
- `npm run format:check`: clean.
- `npm run check:scala-quality`: clean (soft warnings only).

**Specific scrutiny asked for:**
- **Is the 1.5 s witness window flaky or vacuous? Neither.**
  - The witness bus runs `LISTEN` synchronously in its constructor (`PipelineRunNotifyBus.openConnection`, called from the `connection` field initialiser). That happens before the service exists, so no NOTIFY can be sent before the witness is listening. Postgres also queues a notification on a listening connection until it is polled.
  - `assertExactlyOneTerminalPublished` (spec ~L234) first waits up to 15 s for the counter to be non-empty, so the first event is received before the window starts. If the witness never received anything, the assertion `shouldBe Seq(status)` fails rather than passing.
  - Three green repeats were stable.
  - Bound: a duplicate published more than 1.5 s after the first would be missed. That bound is acceptable, and every plausible duplicate path publishes within milliseconds.
- **Trigger fixture cleanup by exact name: yes, on the normal path.** The trigger and function are both `hel1366_fail_terminal_<pipelineId without dashes>`. They are dropped by that exact name in `finally` (`DROP TRIGGER IF EXISTS <name> ON pipeline_runs` and `DROP FUNCTION IF EXISTS <name>()`), and the filter is scoped to `NEW.pipeline_id = '<pid>'`. Gap: `CREATE TRIGGER` at L347 sits *outside* the `try`. If it fails, the already-created function is never dropped. The impact is minor because the embedded database is discarded, but it is part of issue 1.

**Issue 1 — Blocking: on a real regression, the spec hangs forever instead of failing.** I ran the new spec against the pre-fix base `PipelineRunService.scala`, the exact regression this spec exists to catch. The run did not finish:
- The five ordering cases failed correctly, now at `PipelineRunServiceTerminalOrderingSpec.scala:180` ("terminal event received while write blocked").
- Each of those cases throws *before* its `Held.release()` (L321 in `finishFailedCase`, L379/L385 in the succeeded case, L447 in the dry_run case). The test's lock connections therefore stay `idle in transaction`, still holding their `FOR UPDATE` row locks and the `node_snapshots` EXCLUSIVE lock.
- The service's blocked `UPDATE pipeline_runs` / `INSERT` transactions keep waiting behind those locks while holding ROW EXCLUSIVE on `pipeline_runs`.
- The first trigger case then issues `CREATE TRIGGER ... ON pipeline_runs` (L347). That statement needs SHARE ROW EXCLUSIVE, has no `lock_timeout` or `statement_timeout`, and is not covered by the spec's await timeouts.
- It blocked indefinitely: more than 10 minutes, with `pg_blocking_pids` = `{2707215,2707175,2707099,2706967,2706899}` (the service backends), each blocked by a leaked test lock. `eval2-hang-diagnosis.txt` is the `pg_stat_activity` snapshot.
- I ended the hang only by calling `pg_cancel_backend` on the two `CREATE TRIGGER` backends of the throwaway embedded database. The run then reported 7/7 FAILED.

So a future reintroduction of publish-before-persist would not produce a red suite in CI. It would hang the backend test job until the job-level timeout, which is exactly the kind of "regression that doesn't fail cleanly" C6 is meant to rule out.

The executor's own red evidence did not surface this. Its red runs were against the mutant, where ordering holds, every lock is released, and the trigger DDL never waits.

### Phase 3: UI Review — N/A
No UI-trigger paths changed this cycle. The cycle-1 hel1094 repeat (4/4) was run against e075255de. This cycle's service change only refactors how each write chain is built, and testFull is green, so I did not re-run hel1094 on the dev servers that are still running. Those servers were started at e075255de, and reusing them would have measured stale code.

### e2e-evidence deletion (asked to note)
**This is a real tooling defect on `main`, worth a follow-up ticket. It is not this ticket's defect.**
- HEL-1363 (54c2f222e) added `e2e/support/evidencePath.ts`, which writes to the gitignored top-level `/e2e-evidence/` (`.gitignore:103`). It did not add `e2e-evidence` to `IGNORED_TOP_LEVEL` in `scripts/check-no-credential-in-agent-surface.mjs`, at around L762 (the HEL-956 coverage-drift guard, whose hand-maintained list is `node_modules, dist, build, coverage, playwright-report, test-results`).
- `origin/main` (d125b6541) still has the same list.
- As a result, any local run of a spec that uses `evidencePath` (hel1277, hel1350 and hel1351 all do) creates an unclassified top-level directory, and the next commit's pre-commit hook fails until someone deletes the evidence by hand. That deletion also throws away the evidence `evidencePath` exists to keep.
- Suggested follow-up: add `"e2e-evidence"` to `IGNORED_TOP_LEVEL` (the file's own header requires that in the same commit as any new ignored top-level directory), plus a selftest case for it.
- The executor's deletion was a reasonable workaround. That directory held only my cycle-1 run's screenshots, none of which my report cites.

### Overall: FAIL

### Change Requests
1. **Make the spec fail cleanly, never hang, when the ordering regresses.** In `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceTerminalOrderingSpec.scala`:
   - (a) Release every held lock on every path. For example, register each `Held` in a per-test collection and release all of them in a `try/finally` around each case body. Equivalent: `BeforeAndAfterEach.afterEach` doing a rollback/close that is a no-op if the lock was already released. This makes L321/L379/L385/L447 no longer the only release points.
   - (b) Before the DDL in `withFailingTerminalUpdate`, run `SET lock_timeout = '5s'` on its dedicated connection, so a stuck `CREATE TRIGGER` fails loudly instead of waiting forever. Also move `CREATE TRIGGER` (L347) inside the `try`, so the function is dropped even if trigger creation fails.
   - (c) Re-run the spec against the base `PipelineRunService.scala`. Confirm it **completes** with the five ordering cases red at the ordering assertion and the two trigger cases red (or at least terminated), with no hang. Persist that log as the cycle's red evidence.

### Non-blocking Suggestions
- Open the follow-up ticket for `e2e-evidence` in `IGNORED_TOP_LEVEL` described above (main tooling, outside HEL-1366's scope).
- The proposed `PipelineRunService.scala` split, recorded in files-modified.md for the PR description, looks right as its own behaviour-preserving ticket.
