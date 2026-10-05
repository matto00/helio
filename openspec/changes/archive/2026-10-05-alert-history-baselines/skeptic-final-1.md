## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `c7caa4f2845800d4da0461ac848df2b4f67221b6`. Diff base `2f4956509d0e125414335d99fc44628f6d264cc2`, resolved live with `resolve-review-base.sh` (exit 0). The branch has one commit on top of the base.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/alert-history-baselines/HEL-1278`.
- **Scope and parallel lanes:** `git diff --stat BASE...HEAD` lists 23 files. In production code it touches only `ApiRoutes.scala` (1 line, :419), `AlertEvaluationService.scala`, `AlertRuleService.scala` and the new `HistoryBaseline.scala`, plus the three `schemas/alerts/*alert-rule*` files. `PipelineSchedulerService`, `Main.scala`, `OutputRoutes`, `OutputService`, `PublicDashboardRoutes`, `PipelineRunService.scala`, `OutputSummaryReducer` and `OutputHistoryRepository` are absent from the diff. There is no migration and no `frontend/**` or MCP change.
- **AC1, red/green breach and resolve for previous and rolling_avg:** `AlertEvaluationServiceSpec` has "breach then resolve against the previous run (abs)" (80→120 fires with exact `{value 120, baseline 80, delta 40, mode abs}`, then 125 vs 120 resolves) and "breach then resolve against the rolling average (pct)" (mean 120, 84 gives -30%, fires, then resolves). These cases use real `OutputHistoryRepository` rows on embedded PG.
- **AC2, empty history means no breach:** "create no event when history is empty" covers both kinds. In code, `baselineValue` returns `None` when there are fewer than k eligible points (HistoryBaseline.scala), and the rule is then skipped.
- **AC3, malformed baseline returns 400 on create and update:** `AlertRuleService.validateCondition` runs `HistoryBaseline.parse` after the comparator and threshold checks. The update path validates only when a condition is supplied (AlertRuleService.scala:99), so stored rules are not re-validated by an unrelated PATCH. **I checked this live** against the composed dev backend (:9617). POST with `baseline:"median"` returned `400 condition.baseline must be "previous" or "rolling_avg"`. PATCH with a baseline but no `mode` returned `400 condition.mode is required with condition.baseline`. A well-formed POST returned 201.
- **AC4, exclusion proof under C1:** I read the two "EXCLUDE ..." fixtures and traced each mutation by hand:
  - `previous`, fixture r1=100 plus cur=120 (newest):
    - M1 (no run-id filter) makes the baseline 120 and the delta 0, so there is no event and the `Some(100)` assertion goes red.
    - M2 (`listRecent(1)`) returns [cur]; filtering it leaves nothing, so the rule skips and the test goes red.
  - `rolling_avg n=2`, fixture r1=80, r2=120, cur=10:
    - M1 makes the mean 65 rather than 100, so the test goes red.
    - M2 leaves one eligible point, fewer than 2, so the rule skips and the test goes red.

  The evaluator also re-applied M1 and M2 against the real code and got 2 failures each. `PipelineRunServiceAlertBaselineSpec` is labelled a seam check and is not cited as the proof. **C1 is honored.**
- **AC5, schemas and API-only:** all three alert-rule schemas gain `baseline`/`n`/`mode`, with enums and bounds that match `HistoryBaseline.parse` (n is 1..100, n is forbidden for `previous`). `alert-event.schema.json` declares `value: {}`, so the new object-shaped event value `{value, baseline, delta, mode}` stays within the contract. `npm run check:schemas` reports "schemas in sync with JsonProtocols (118 checked across 53 protocol files)".
- **Comparability of current and stored values:**
  - **Same rows on both sides.** The write path (PipelineRunService.scala:1426-1449) summarizes `nodeOutcomes(nodeKey).rows` through `PipelineRowJson.anyToJsValue` and `OutputSummaryReducer.summarize(rows, o.kind, config)`. Alert evaluation receives the same `nodeOutcome.rows` (:1531), and `HistoryBaseline.currentSummary` applies the same conversion and reducer.
  - **Kind and config don't matter here.** `summarize` uses kind and config only for the `metric` and `series` fields (OutputSummaryReducer.scala:55-56). `rowCount` and `columns` (where coercion, blank handling and the 20-column cap live) do not depend on either, so the `Table`/empty-config call yields the same `columns[metric].sum` and `rowCount` as the stored summary.
  - **Live check.** A **metric-kind** Output over numeric-string cells `"10"`/`"20"` stored `sum 30.0` in history, and the fired event carried `value 30.0, baseline 30.0`.
- **Threshold rules unchanged:**
  - **Code path.** `evaluateThresholdRule` is the old body. The only refactor is that the breach and resolve arms moved into `applyOutcome`, still passing `JsNumber(value)`. `extractMetric` and `parseCondition` are untouched.
  - **Dispatch.** Routing depends only on the presence of a `baseline` key. A rule with a stray `n`/`mode` key and no `baseline` still evaluates as a threshold rule. It is rejected only if a client re-submits its condition.
  - **Test.** "leave plain threshold rules byte-unchanged" passes.
  - **Dev DB.** A read-only count (`SELECT ... FROM alert_rules`) found 0 rules with `baseline`, `n` or `mode` keys (0 rules total), so no existing dev data changes behaviour.
- **Production wiring (ApiRoutes.scala:419):**
  - **Declaration order.** `outputHistoryRepoOpt` is declared at :253, before :415, so there is no val-initialization-order null. The same instance also feeds the history write at :471.
  - **Live end-to-end probe** against the composed `ApiRoutes`/Main backend started by `start-servers.sh` (`assert-phase.sh servers` → `PASS servers`). I created a static-root pipeline `785fddec-…`, a metric Output `5f0238c4-…` and a rule `e2c80b88-…` with condition `{baseline: previous, mode: abs, gte 0}`, then ran the pipeline twice.
    - History holds two rows, one per run id (48e40980… at 08:10:46.004, e2e7d1cc… at 08:10:54.926).
    - Exactly one alert event exists: `firing`, value `{"mode":"abs","delta":0.0,"value":30.0,"baseline":30.0}`, `pipeline_run_id = e2e7d1cc…` (run 2), `first_fired_at 08:10:54.937`.
    - The rule fires on any comparison (gte 0). Its event's first_fired_at is later than run 1, so run 1 produced no comparison, as expected with empty prior history. These are DB column values, not file mtimes.
    - If `outputHistoryRepo` were null, no event could exist at all (the rule would log a warning and skip). This shows the production wiring works at this HEAD.
    - Cleanup was by exact id through the API (DELETE rule, pipeline and source each returned 204). A follow-up exact-id count returned 0 for the rule, the event, the pipeline, the output, the source, the history rows and the pipeline_runs rows.
- **Gates re-run by me:**
  - Targeted run, `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt "testOnly com.helio.services.alerts.* com.helio.api.routes.alerts.* …PipelineRunServiceAlertBaselineSpec …PipelineRunRoutesSpec"`: "Total number of tests run: 168 … succeeded 168, failed 0 … All tests passed". The log shows live execution with today's timestamps.
  - Full run, `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: exit 0, "Total number of tests run: 5895 / Suites: completed 408, aborted 0 / Tests: succeeded 5895, failed 0 / All tests passed."
  - **FirstRunRoutesSpec ran and passed. There was no timeout: 0 matches for `RouteTestTimeout` or "neither completed nor rejected".**
  - `sbt --client shutdown` was issued afterwards ("no sbt server is running").

### Verdict: CONFIRM

### Change Requests

None.

### Ruling on the evaluator's wiring note (non-blocking, with reasons)

The ApiRoutes:419 line has no automated test. Reverting it would silently disable baseline rules in production, leaving only a warn log. I judge this **acceptable for this ticket and not a required change**, for three reasons:

1. **No AC covers it.** The ACs ask for behaviour, exclusion, validation and schemas, and all of these are proven at the service and route level.
2. **Project precedent leaves this seam untested.** No test that composes `new ApiRoutes(...)` touches alerts or output history (grep over `backend/src/test` found none). The pre-existing HEL-466 threshold-alert wiring at :415-419 and L1's own history wiring at :471 are equally untested at the composition root. Requiring the test only here would hold this ticket to a bar nothing else in the area meets.
3. **The live probe proves it works now.** I verified the wiring at this HEAD against the real composed server (above).

The residual risk is regression protection, not correctness. The realistic failure is a future ApiRoutes reorder that moves `outputHistoryRepoOpt` below :415, since Scala val-init order would make it null silently. That deserves a follow-up ticket covering alerts and history together. One option is a composed-ApiRoutes spec (`ApiRoutesPipelineRunGuardSpec` already composes ApiRoutes and runs pipelines) that runs a pipeline twice with a `previous` rule and asserts an event. Another is to make the skip on a missing history repo louder than a warn.

### Non-blocking notes

- The comment in AlertEvaluationServiceSpec, "EXCLUDE ... (rolling_avg ...)", says the self-inclusive mean "would be 55". It would be (10+120)/2 = 65. The assertion is still correct; only the comment is wrong.
- `PipelineRunServiceAlertBaselineSpec` uses identical data for both runs (30/30). So does my live probe. Neither can distinguish exclusion from self-inclusion, which is fine under C1 because the deterministic spec carries that proof. The evaluator's suggestion stands: different data on run 2 would make it a stronger seam check, and `shouldBe Some(run2)` would be clearer than the hedged matcher.
- `listRecent` sorts all history points for the Output by `captured_at`, regardless of trigger source or dry runs. A concurrently completing later run could become another run's "previous". This edge is inherent to the concurrent design and acceptable for v1.
