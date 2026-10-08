# HEL-1283: Composed-ApiRoutes test for alert + output-history wiring (baseline alert fires end to end)

## Description

origin_kind: followup
origin_ticket: HEL-1278

The HEL-1278 reviewers flagged that no test covers the `ApiRoutes` line (~:419) that passes `outputHistoryRepoOpt.orNull` into `AlertEvaluationService`. The same gap applies to the existing threshold-alert wiring and to L1's history wiring. If a future reorder of `ApiRoutes` left the repository unset, baseline alerts would silently stop firing with only a warn log.

(Premise note, verified 2026-10-08 against main d2601e258: the line is now `ApiRoutes.scala:409-413`, `new AlertEvaluationService(ruleRepo, eventRepo, resolvedOutputHistoryRepo)`, where `resolvedOutputHistoryRepo` falls back to a `dbContext`-derived repo. `AlertEvaluationService`'s third param still defaults to `null`, and a null repo still only logs a warn and skips every baseline rule — so the gap the ticket describes still exists in kind.)

## Acceptance Criteria

* A composed-ApiRoutes spec in the style of `ApiRoutesPipelineRunGuardSpec`, extending `HelioRouteTest`. It runs a pipeline twice with a `previous` baseline rule and asserts exactly one alert event. It also asserts a threshold rule fires, and that a history row exists after the run.
* Red under a mutation that leaves the history repository unwired (null) in ApiRoutes.
* Use different data across the two runs, so exclusion of the current run is distinguishable from self-inclusion. The HEL-1278 seam spec used identical data and couldn't tell the two apart.

## Driver context (binding constraints for this run)

* Test-only change expected. Any production change to ApiRoutes/Main/OutputService must be escalated to the driver first (OutputService is contended with concurrent HEL-1313).
* Demand a red: the test must fail when the history->alert wiring is broken; a test that passes with the wiring removed guards nothing.
* Deterministic time: no sleeps-as-sync; pin instants / inject clocks where time matters (HEL-1323, HEL-1374 precedents).
