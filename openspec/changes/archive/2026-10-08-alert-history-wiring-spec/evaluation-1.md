## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 69ac799fac450a11f532fe25ecaf9c1ba1336a45
Review base (resolved live via resolve-review-base.sh main origin): d2601e2581b8a26373456b1b65078c67d5612bf6
Changed files: one new test spec (`backend/src/test/scala/com/helio/api/ApiRoutesAlertHistoryWiringSpec.scala`, 234 lines) plus the change-dir artifacts. `backend/src/main` is untouched.

### Phase 1: Spec Review — PASS
- AC1 (composed-ApiRoutes spec extending HelioRouteTest; two runs with a `previous` baseline rule giving exactly one event; threshold rule fires; history row exists): met. T1 checks the history row through `GET /api/outputs/:id/history` and checks that the threshold event exists. T2 counts per rule id: there is exactly one baseline event, on run 2, with value `{value:100, baseline:30, delta:70, mode:abs}`.
- AC2 (red under the history-repo-unwired mutation): I re-applied M1 myself (see Phase 2) and it went red.
- AC3 (different data across runs): run 1 sums to 30 and run 2 to 100, via SQL replacement. The JSON-number cells follow D3.
- D1: `ApiRoutes` gets `dbContext = ctx`, `alertRuleRepo`, `alertEventRepo`, and `outputHistoryRepo = ReadAfterWriteHistoryRepo`. Main passes the same param at `backend/src/main/scala/com/helio/app/Main.scala:277`. The spec never constructs `AlertEvaluationService` or `PipelineRunService` itself.
- D2/D7: both runs go through `POST /api/pipelines/:id/run`. There is no `Thread.sleep` and no `eventually` (a grep of the spec found zero hits). The only wait is D3b's bounded `pekkoAfter(20.millis)` poll, which re-checks a DB count against a 5s deadline.
- D3b / C2: `satisfied` and `timedOut` are recorded and reset on each arm. Before any run-2 alert assertion the spec asserts `satisfied >= 1` and `timedOut == 0` (spec:214-217). The repo is disarmed before every GET-history read.
- C1: mutation-evidence.md reports M4 as a measured 5/5 under the forced ordering and explicitly does not claim a proof for arbitrary interleavings.
- Tasks are all checked and match the implementation. There is no scope creep and no schema/API impact.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH:
- `nice -n 19 sbt "testOnly com.helio.api.ApiRoutesAlertHistoryWiringSpec"` on the clean tree: 2/2 green, `D3b armed wait: satisfied=1 timedOut=0`.
- Independent M1 (`ApiRoutes.scala:413`, `new AlertEvaluationService(ruleRepo, eventRepo, resolvedOutputHistoryRepo)` changed to `new AlertEvaluationService(ruleRepo, eventRepo)`): T1 stayed green, T2 FAILED at the D3b precondition (`0 was not greater than or equal to 1 (ApiRoutesAlertHistoryWiringSpec.scala:216)`, `satisfied=0 timedOut=0`), exit=1. This matches the executor's M1 transcript. I reverted with `git checkout --`; `git status --short` is clean afterward.
- `nice -n 19 sbt testFull` after the revert: 6147 succeeded, 0 failed, 4 canceled (pre-existing), 441 suites, 0 aborted, exit=0. The new spec is green inside the full run (satisfied=1 timedOut=0).
- `npm run check:scala-quality` passes; the new file is under the 250-line soft budget. `check-openspec-hygiene` is clean.
- Frontend gates: N/A (no `frontend/**` changes).

Review notes: imports are all top-of-file with no inline FQNs. The test-only subclass overrides only `listRecent` and is a pure pass-through when unarmed. The deadlock reasoning (`materializedWrites` and `alertEvaluation` are independent eager vals) is borne out by the green runs. There is no dead code and no new shared helper.

### Phase 3: UI Review — N/A
This is a backend test-only change. No Phase 3 trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**` are all untouched in the diff).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `rawHistory` is a slightly misleading name for an instrumented repo (`raw` suggests an unwrapped one). Consider `historyRepo` or `readAfterWriteHistory`.
- Under M1 and M2, T2's red comes from the D3b precondition, not from the baseline-event assertion. That is correct (the baseline assertion would also be red, since there is no event), but the evidence file could say in one line that the precondition doubles as the "evaluation read history" wiring guard.
