## Evaluation Report — Cycle 2 (evaluation-2.md)

- **Reviewed commit:** `a2eb00ab93167f244c99e1bdd002aac37049677e`, which is `a2eb00ab9` on top of `e6e0f3fd5`. The working tree is clean.
- **Delta since cycle 1:**
  - The `afterTerminalWin` WARN text and scaladoc now use neutral wording.
  - New tests in `OrphanedRunReaperSpec` and `LiveRunReaperSpec`.
  - The comment on `RunReaperConcurrencySpec`'s polling loop was reworded.
  - `evaluation-1.md` is now committed.

### Phase 1: Spec Review — PASS

Cycle 1's Change Request 1 is addressed.

| CR 1 item | Status |
|---|---|
| (a) Repository level | Done. `OrphanedRunReaperSpec` "not overwrite a reaped run, from either entry point, and report false" covers `updateRunTerminalInternal` and the owner-scoped `updateRunTerminal`. Both return `false`, and the row is unchanged. A control case shows that an open run is finalized exactly once. |
| (b) Failure path | Done. `LiveRunReaperSpec` "keep the reaper's failed row and last_run_* (failure path)": a gated run is reaped, then released with `gate.failure`. `error_log`, `last_run_at` and `last_run_status` keep the reaper's values, and there are 0 `pipeline_run_assertions` rows. |
| (c) Blocked path | Done. Same harness, with an error-severity `rowCountMax` assert, so the run takes `onBlockedRun`. |
| (d) Mutations recorded | Done. See `hel1511-mutation-3.4-*.txt`; I also re-ran both mutations myself (Phase 2). |
| (e) tasks.md 3.4 verification note | **Not done.** It still says "Verify with test 4.4". Non-blocking: see Suggestions. |

Other Phase 1 checks:
- **Scope and constraints:**
  - C1: honored. The new tests use the `Clock` seam and Promise gates, and do not sleep.
  - C2: honored. The commit has the `HEL-1511` prefix, no session link, no `Claude-Session` trailer, and no inline FQNs (`check:scala-quality` is clean).
  - C3: honored.
- **V126:** still free. `origin/main` has moved to `b5b5558bc` (HEL-1514, merged as #968). Its highest migration is V125, and it shares no files with this branch.

### Phase 2: Code Review — PASS

**Mutations, re-run by me.** I used a throwaway detached worktree at a2eb00ab9 and removed it afterwards (`git worktree list` confirms it is gone).

1. **Conditional update removed.** `PipelineRunRepository.scala:299` changed from `.filter(r => r.id === runId.value && r.completedAt.isEmpty)` to `.filter(r => r.id === runId.value)`. Result: red, `failed=4`.
   - `"[Pipeline execution failed]" was not equal to "[Run abandoned: no heartbeat for 659 s ...]" (LiveRunReaperSpec.scala:241)`: the failure path.
   - `"Run [blocked: 1 error-severity assertion(s) failed — rowCountMax: Row count 2 exceeds maximum 1]" was not equal to "Run [abandoned: ...]" (LiveRunReaperSpec.scala:241)`: the blocked path.
   - `true was not equal to false (OrphanedRunReaperSpec.scala:229)` and `(…:242)`: the repository level.
2. **afterTerminalWin skip removed.** `PipelineRunTerminalWrites.scala:60` changed from `if (won) work` to `if (true) work`. Result: red, `failed=2`.
   - Both the failure and blocked cases fail at `LiveRunReaperSpec.scala:242`. The real-time `last_run_at` (`23:12:31.148046`) overwrote the reaper's (`23:23:31.093`).

**Affected specs, unmutated, in WORKTREE_PATH at a2eb00ab9.**
- Specs run:
  - the reaper specs: Orphaned, Live, Concurrency and the StaleConfig spec;
  - the auto-run specs: `DatasetWriteAutoRunDroppedFireSpec`, `FireTimeRunConfigGateSpec` and `*AutoRun*`;
  - the run-service and scheduler specs: `PipelineRunService*`, `PipelineScheduler*` and `PipelineRunGuardIntegrationSpec`;
  - persistence, Spark and routes: `com.helio.infrastructure.persistence.pipelines.*`, `SparkJobSubmitterSpec` and `PipelineRunRoutesSpec`.
- Result: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Suites: completed 41`, `Tests: succeeded 517, failed 0`.
- The 4 new cases ran and passed.
- No sbt process was left running.

**Why I did not run a full testFull this cycle:**
- My own cycle-1 `testFull` (7344 passed) covered main code identical to this commit except for a log string.
- The executor's `hel1511-testFull-cycle2.log` reports 7348 passed, with the guard line present. That is its claim. My fresh targeted run above backs it for every spec that touches the changed paths.

**The WARN wording** is now "terminal write skipped (run already terminal or not found)". This resolves cycle 1's suggestion about the misleading "reaped as abandoned" message.

### Phase 3: UI Review — N/A
Unchanged from cycle 1: no frontend, schema or route change. Starting this branch's backend would apply V126 to the shared dev DB, and its reaper would then act on other lanes' rows.

### Overall: PASS

### Non-blocking Suggestions
1. **tasks.md 3.4** still says "Verify with test 4.4" (CR 1(e)). Change it to name `OrphanedRunReaperSpec` "the conditional terminal update" and `LiveRunReaperSpec` "a reaped run whose engine then FAILS or is BLOCKED" before archive, so the archived artifact matches the evidence.
2. **origin/main** has moved to `b5b5558bc` (HEL-1514). There is no file overlap and no migration collision. Re-sync before the PR, as the design's Risks section already plans.
3. **PR body:** carry the read-only prod count query and the Q5 data-effects note.
