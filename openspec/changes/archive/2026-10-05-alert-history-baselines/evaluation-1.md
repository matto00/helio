## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `c7caa4f2845800d4da0461ac848df2b4f67221b6`. Diff base: `2f4956509d0e125414335d99fc44628f6d264cc2`, resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1, red/green breach and resolve: `AlertEvaluationServiceSpec` has "breach then resolve against the previous run (abs)" and "... rolling average (pct)". Both assert the exact `{value, baseline, delta, mode}` event value and then the resolve. The numbers differ from the spec scenarios (80/120 instead of 100/120, and 100/120/140→84 instead of 100/110/90→70). The executor changed them on purpose so M3 and M4 stop passing by coincidence. The semantics are the same.
- AC2, empty history means no breach: "create no event when history is empty" covers this for both kinds. M5 makes it red.
- AC3, a malformed baseline returns 400 on create and update: `AlertRuleService.validateCondition` (AlertRuleService.scala:153) delegates to `HistoryBaseline.parse`. The service spec covers 12 malformed shapes on `create` and `update`, and checks that `update` does not mutate the rule. `AlertRuleRoutesSpec` sends the same 12 shapes over HTTP and gets 400 on both POST and PATCH. Well-formed conditions round-trip with 201 and 200.
- AC4, exclusion proof under Constraint C1: the two "EXCLUDE ..." tests use exactly k older points plus the current run's point, and the current run's point has the newest `captured_at`. If the current run's own point were included, the verdict or the baseline value would change. I re-applied M1 and M2 myself (below) and both turn these tests red. `PipelineRunServiceAlertBaselineSpec` is labelled a seam check and is never cited as the exclusion proof. **C1 is honored.**
- AC5, API-only plus schemas: no `frontend/**` or MCP changes. The three `schemas/alerts/*alert-rule*.schema.json` files gain `baseline`/`n`/`mode`, and the outdated "validates only comparator/threshold" description is fixed.
- All tasks.md items are checked and match the diff. The spec deltas (alert-evaluation-engine, alert-rule-crud-api) match the implemented behaviour, including null `baseline` → 400, `n`/`mode` without `baseline` → 400, and pct with a zero baseline → skip.
- Scope: the files outside the intended area are untouched. The diff contains no changes to `PipelineSchedulerService`, `Main.scala`, `OutputRoutes`, `OutputService`, `PublicDashboardRoutes`, `OutputHistoryRepository`, `OutputSummaryReducer` or `PipelineRunService.scala`, and no `db/migration` file. `ApiRoutes` changes by one line (:419).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself:
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: **5895 run, 5895 succeeded, 0 failed** ("All tests passed", 455 s). `FirstRunRoutesSpec` ran and passed. The log has no `RouteTestTimeout` and no "neither completed nor rejected" lines, so **no FirstRunRoutesSpec timeout**. All five new or extended specs ran.
- `npm run check:schemas`: in sync. `check:scala-quality`: clean, with no new inline FQNs. `npx prettier --check` on the changed schemas and openspec files: clean. `check:openspec`: clean. `check:no-credential-leak`: 0 violations.
- No `frontend/**` files changed, so the frontend gates do not apply.

Mutation evidence (I re-applied each mutation, ran `testOnly AlertEvaluationServiceSpec`, then restored the original file from a byte-exact copy and confirmed `git status` was clean afterwards):
- **M1**: `HistoryBaseline.eligible` changed to `points.take(k)`. Result: 32 passed, **2 failed** (both EXCLUDE tests). This matches the executor's claim.
- **M2**: `listRecent(..., baseline.kind.k)` instead of `k + 1`. Result: 32 passed, **2 failed** (both EXCLUDE tests). This matches the executor's claim.
- I did not re-run M3 to M6. The executor's M1 and M2 claims were accurate, and the fixtures for M3 and M4 visibly avoid the coincidences the executor reported fixing.

Comparability of the current value and the stored summary: verified. The write path (PipelineRunService.scala:1426-1449) builds `nodeJsRows` from `outcome.rows` using `PipelineRowJson.anyToJsValue` and stores `OutputSummaryReducer.summarize(nodeJsRows, o.kind, config)`. `HistoryBaseline.currentSummary` does the same conversion on the same `nodeOutcome.rows` that alert evaluation receives (:1532). It runs `summarize` with `OutputKind.Table` and an empty config. `columnStats` and `rowCount` do not depend on kind or config, so `columns[metric].sum` and `rowCount` come out identical on both sides. Wiring is also correct: the same `outputHistoryRepoOpt.orNull` instance feeds `AlertEvaluationService` (ApiRoutes:419) and the `PipelineRunService` history write (:471).

Threshold path: behaviour is unchanged. The breach and resolve arms moved into `applyOutcome`, still with `JsNumber(value)`. `extractMetric` and `parseCondition` were not edited, and the test "leave plain threshold rules byte-unchanged" passes.

Error handling: a malformed stored baseline condition throws inside `Future.fromTry`. The per-rule `recover` catches it, and the sibling-isolation test confirms other rules are unaffected. A missing history repo or a missing run id is logged at warn and the rule is skipped. A missing current value is logged at info.

Type safety and conventions: the trailing `= null` parameter follows the codebase's existing nullable-default convention (PipelineRunService's `outputHistoryRepo = null`). There is no `Any`/`asInstanceOf` escape hatch. `HistoryBaseline.scala` is 113 lines and AlertEvaluationService.scala is 206, both under the 250-line soft budget.

### Phase 3: UI Review — N/A
`schemas/**` matches a trigger, but alerts are API-only. No `frontend/**` file changed, and nothing under `frontend/src` or `helio-mcp` references alert rules, so there is nothing to render or exercise in a browser.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- The one-line production wiring at `ApiRoutes.scala:419` has no test. Reverting it to `new AlertEvaluationService(ruleRepo, eventRepo)` would not turn anything red: every new spec builds its own `AlertEvaluationService`, and if the wiring were lost, baseline rules would silently never fire (only a warn log). A follow-up could add a route-level or ApiRoutes-fixture test that runs a pipeline with a baseline rule.
- `PipelineRunServiceAlertBaselineSpec` uses the same data for both runs (30/30), so its `baseline = 30` assertion cannot tell run 1's point apart from a self-included run 2 point. That is acceptable for a seam check under C1, but giving run 2 different data would make it a stronger seam check. The matcher `should (contain(run2) or be(Some(run2)))` (:598) is also needlessly hedged; `shouldBe Some(run2)` would be clearer.
