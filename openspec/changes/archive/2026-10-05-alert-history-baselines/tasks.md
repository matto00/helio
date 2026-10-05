## Standing Constraints

- [C1] The AC4 exclusion proof is the deterministic AlertEvaluationServiceSpec test (current-run point inserted directly with the NEWEST captured_at, fixture with EXACTLY k older points + the current-run point, values chosen so self-inclusion flips the verdict); it must go red under (i) removing the run-id filter and (ii) listRecent(k) instead of k+1. The PipelineRunService end-to-end test (2.3) is a seam check only and is never cited as the exclusion red proof.

## 1. Backend

- [x] 1.1 Add pure `services/alerts/HistoryBaseline.scala` (condition parsing, summary value accessor, current-value-via-reducer, selection excluding run id, rolling mean, abs/pct delta); verify via HistoryBaselineSpec
- [x] 1.2 `AlertEvaluationService`: optional `outputHistoryRepo` param; branch baseline rules per design D1-D5; threshold path byte-unchanged; verify AlertEvaluationServiceSpec existing cases still pass
- [x] 1.3 `AlertRuleService.validateCondition`: baseline rules per design D6 for create and update; verify AlertRuleServiceSpec
- [x] 1.4 `ApiRoutes`: pass `outputHistoryRepoOpt.orNull` to `AlertEvaluationService` (one line); verify compile + route specs
- [x] 1.5 Update `schemas/alerts/{alert-rule,create-alert-rule-request,update-alert-rule-request}.schema.json` condition with baseline/n/mode; also fix the condition/alert-rule `description` strings that say only comparator/threshold are validated; verify schema-drift pre-commit check passes

## 2. Tests

- [x] 2.1 HistoryBaselineSpec: parsing, `sum: null` (non-finite) column treated as no value, accessor ("*" vs column sum, numeric strings, absent column), exclusion, insufficiency, pct zero baseline
- [x] 2.2 AlertEvaluationServiceSpec (embedded PG + real OutputHistoryRepository rows): previous breach→resolve, rolling_avg breach→resolve, empty history no event, current-run point present is excluded (deterministic), None run id skipped; each red under a named mutation first: M1 drop run-id filter, M2 listRecent(k) not k+1, M3 abs/pct formula swapped, M4 rolling mean over k-1 points, M5 skip-on-empty replaced by baseline 0 (per C1)
- [x] 2.3 PipelineRunService-level spec: two real runs with a `previous` rule; event baseline equals run 1's value (seam check of real wiring; NOT the exclusion red proof, it is racy — see C1)
- [x] 2.4 AlertRuleServiceSpec + AlertRuleRoutesSpec (HelioRouteTest): malformed baseline (unknown kind, null, missing mode, bad n, n on previous, n/mode without baseline) → 400 on POST and PATCH, M6 validation removed goes red; well-formed round-trips 201
- [x] 2.5 `nice -n 19 sbt testFull` green (Bash timeout 600000, ≤2 workers); report any FirstRunRoutesSpec timeout
