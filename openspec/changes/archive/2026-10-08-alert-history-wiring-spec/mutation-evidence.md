# HEL-1283 mutation evidence

Spec: `backend/src/test/scala/com/helio/api/ApiRoutesAlertHistoryWiringSpec.scala` (2 tests:
T1 "record a history row and fire a threshold rule ... no baseline event yet";
T2 "fire a `previous` baseline rule exactly once across two runs ... run 1's value as baseline").
Command for every run: `nice -n 19 sbt "testOnly com.helio.api.ApiRoutesAlertHistoryWiringSpec"` (from `backend/`).
Each mutation was applied with `sed`, run, then reverted with `git checkout --`; after all four,
`git diff origin/main --stat -- backend/src/main` is empty.
Failing lines below are the ACTUAL ones observed (not the design's predictions). Spec line numbers:
190 = T1 history-row size assertion, 194 = T1 threshold-event size assertion, 216 = T2 D3b precondition
(`satisfied >= 1`), 221 = T2 baseline-event size assertion.

## 1.1 D2 sequencing evidence (no `eventually`, no sleeps)

`POST /api/pipelines/:id/run` -> `PipelineRunSubmitRoutes`: `ServiceResponse.run(runService.submit(...))` (returns the future).
`PipelineRunService.submit` (:255) -> `runPipeline` (:343) -> `runFuture.transformWith { Success => executeRunSuccess(...) }` (~:1111)
-> `executeRunSuccess` (:1172): `followUp = onRunSuccess(...)` (~:1210-1216), response built in `followUp.map` (~:1217)
-> `onRunSuccess` (:1288) ends with `publishTerminalAfter(..., writesChain())` (:1642)
-> `writesChain` (:1438): `for { _ <- materializedWrites; _ <- binaryRefsUpsert; _ <- alertEvaluation; _ <- updateMeta; ... } yield None`
-> `publishTerminalAfter` (:997-1003) returns `writes` unchanged.
So the HTTP 200 is produced only after the history write and alert evaluation futures completed; the spec reads DB state after
`check { status shouldBe OK }` with no polling.

Deadlock check for the D3b wait: `materializedWrites` (`outputRepo.listByPipelineInternal(...).flatMap(...)`, :~1446) and `alertEvaluation`
(:~1565, `if (alertEvaluationService != null) outputRepo.listByPipelineInternal(...)`) are both eagerly started `val`s that do not reference each
other, so waiting inside `listRecent` cannot block the history write it waits for (confirmed by the green runs: `satisfied=1 timedOut=0`).

Run 2's id comes from the run response body (`RunResultResponse.runId`), parsed in `runViaApi`.
Seed (1.2): `amount` cells are JSON numbers; run 1 rows [10],[20] (sum 30); run 2 rows replaced via SQL with [40],[60] (sum 100);
baseline rule `previous`/`abs`/`gte 50`; threshold rule `gte 1`.

## Clean tree: 3 consecutive green runs

```
run1 exit=0   D3b armed wait: satisfied=1 timedOut=0   Tests: succeeded 2, failed 0
run2 exit=0   D3b armed wait: satisfied=1 timedOut=0   Tests: succeeded 2, failed 0
run3 exit=0   D3b armed wait: satisfied=1 timedOut=0   Tests: succeeded 2, failed 0
```

## M1 -- history repo not passed to AlertEvaluationService (ApiRoutes.scala:413)

```
-    } yield new AlertEvaluationService(ruleRepo, eventRepo, resolvedOutputHistoryRepo)
+    } yield new AlertEvaluationService(ruleRepo, eventRepo)
[info] - should record a history row and fire a threshold rule on a real run, with no baseline event yet        (green)
[info] - should fire a `previous` baseline rule exactly once ... *** FAILED ***
[info]   D3b precondition: evaluation read history (wiring cut or D3b mis-armed if satisfied = 0) and did not time out: 0 was not greater than or equal to 1 (ApiRoutesAlertHistoryWiringSpec.scala:216)
[info]   + D3b armed wait: satisfied=0 timedOut=0
[info] Tests: succeeded 1, failed 1     exit=1
```
Red at the precondition (evaluation never reads history: the null repo takes the warn-and-skip branch); threshold test stays green.
Note: the precondition fires before the baseline-event assertion, so the baseline-event line itself is not reached under M1.

## M2 -- alert service not passed to PipelineRunService (ApiRoutes.scala:444)

```
-    alertEvaluationServiceOpt.orNull, connector, auditService,
+    null, connector, auditService,
[info] - should record a history row and fire a threshold rule ... *** FAILED ***
[info]   Vector() had size 0 instead of expected size 1 (ApiRoutesAlertHistoryWiringSpec.scala:194)
[info] - should fire a `previous` baseline rule exactly once ... *** FAILED ***
[info]   D3b precondition: ... 0 was not greater than or equal to 1 (ApiRoutesAlertHistoryWiringSpec.scala:216)
[info]   + D3b armed wait: satisfied=0 timedOut=0
[info] Tests: succeeded 0, failed 2     exit=1
```
Assertion failures (it compiles), not compile errors. T1 reds at the threshold event (194); the history-row assertion (190) before it passed.

## M3 -- history repo not passed to PipelineRunService (ApiRoutes.scala:460)

```
-    outputHistoryRepo = resolvedOutputHistoryRepo,
+    outputHistoryRepo = null,
[info] - should record a history row and fire a threshold rule ... *** FAILED ***
[info]   Vector() had size 0 instead of expected size 1 (ApiRoutesAlertHistoryWiringSpec.scala:190)
[info] - should fire a `previous` baseline rule exactly once ... *** FAILED ***
[info]   D3b precondition: ... 0 was not greater than or equal to 1 (ApiRoutesAlertHistoryWiringSpec.scala:216)
[info]   + D3b armed wait: satisfied=0 timedOut=1
[info] Tests: succeeded 0, failed 2     exit=1
```
As predicted, under M3 the armed wait TIMES OUT (no history is ever written); the precondition assertion is the red there, and T1's
history-row assertion (190) is red independently.

## M4 -- measurement: drop the `filterNot` that excludes the triggering run (HistoryBaseline.scala:97)

```
-    points.filterNot(_.runId.contains(triggeringRunId)).take(k).toVector
+    points.take(k).toVector
```
Result: **5/5 red**. In every run the D3b precondition HELD (`satisfied=1 timedOut=0`), T1 stayed green, and T2 failed at the
baseline-event assertion, identically each time:

```
run1: [info]   Vector() had size 0 instead of expected size 1 (ApiRoutesAlertHistoryWiringSpec.scala:221)  + D3b armed wait: satisfied=1 timedOut=0
run2: (same)  run3: (same)  run4: (same)  run5: (same)       Tests: succeeded 1, failed 1  exit=1  (each)
```
Mechanism: with run 2's point forced visible, self-inclusion makes the baseline 100, delta 0, no breach, no event. With exclusion intact
the event carries baseline 30 / delta 70 (asserted in the green runs).

Honesty note (C1): 5/5 is a measurement over 5 runs under a forced read-after-write ordering (D3b), not a proof for arbitrary
interleavings; the unit-level deterministic exclusion proof remains `AlertEvaluationServiceSpec`.

## Production diff

`git diff origin/main --stat -- backend/src/main` -> empty (test-only change).
