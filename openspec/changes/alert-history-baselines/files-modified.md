- `backend/src/main/scala/com/helio/services/alerts/HistoryBaseline.scala` — new pure helper: condition parse/validate, summary accessor, current value via OutputSummaryReducer, run-id exclusion, baseline value, delta
- `backend/src/main/scala/com/helio/services/alerts/AlertEvaluationService.scala` — optional outputHistoryRepo; baseline rules branch (listRecent(k+1), exclusion, {value,baseline,delta,mode} event); threshold path unchanged
- `backend/src/main/scala/com/helio/services/alerts/AlertRuleService.scala` — validateCondition delegates baseline/n/mode validation to HistoryBaseline.parse
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — one-line wiring: outputHistoryRepoOpt.orNull into AlertEvaluationService
- `backend/src/test/scala/com/helio/services/alerts/HistoryBaselineSpec.scala` — pure unit tests
- `backend/src/test/scala/com/helio/services/alerts/AlertEvaluationServiceSpec.scala` — embedded-PG baseline tests incl. deterministic exclusion proof (C1)
- `backend/src/test/scala/com/helio/services/alerts/AlertRuleServiceSpec.scala` — malformed baseline -> 400 on create/update, well-formed round-trip
- `backend/src/test/scala/com/helio/api/routes/alerts/AlertRuleRoutesSpec.scala` — malformed baseline -> 400 on POST/PATCH, well-formed round-trip
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceAlertBaselineSpec.scala` — seam check: two real runs, previous rule (not the exclusion proof)
- `schemas/alerts/alert-rule.schema.json` — baseline/n/mode documented in condition
- `schemas/alerts/create-alert-rule-request.schema.json` — baseline/n/mode documented; stale description fixed
- `schemas/alerts/update-alert-rule-request.schema.json` — baseline/n/mode documented

## Mutation evidence (each applied temporarily, reverted)
- M1 drop run-id filter (HistoryBaseline.eligible): FAILED "EXCLUDE the triggering run's own history point (previous)" and "(rolling_avg, exactly n older points)"
- M2 listRecent(k) instead of k+1: FAILED the same two EXCLUDE tests
- M3 abs/pct formulas swapped: FAILED "breach then resolve ... previous (abs)", "... rolling average (pct)", "skip a pct rule whose baseline is zero" (first run of M3 passed 33/34 because the fixtures were coincidentally 100-based; fixtures made non-coincidental, then 3 red)
- M4 rolling mean over k-1 points: FAILED "breach then resolve against the rolling average (pct)" and "EXCLUDE ... (rolling_avg ...)" (first fixtures were coincidentally symmetric and stayed green; fixed, then red)
- M5 empty history -> baseline 0: FAILED "create no event when history is empty"
- M6 validation removed in AlertRuleService: FAILED AlertRuleServiceSpec create + update cases and AlertRuleRoutesSpec POST/PATCH 400 case
