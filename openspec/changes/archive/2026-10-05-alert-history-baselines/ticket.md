# HEL-1278: HEL-918 L8: Alert conditions over history (previous / rolling average)

## Description

Leaf L8 of epic HEL-918 (snapshot history & deltas on every Output). Owner rulings D1-D10 (2026-10-05)
apply; D10: alert baselines go last, alerts are API-only today. Depends on L1 (HEL-1271, merged as
1606ba8c / PR #765), which shipped `output_snapshot_history`, `OutputHistoryRepository`
(`listRecent`, `nearestAtOrBefore`, ...), `OutputSummaryReducer`, the transactional write path from
`PipelineRunService.onUnblockedRunSuccess`, and pre-wired `outputHistoryRepoOpt` in ApiRoutes.

L1's recorded divergence for L8: `AlertEvaluationService.extractMetric` (AlertEvaluationService.scala:60-67,
`numericValue` :43-51) does not coerce numeric strings, sums across rows, and treats `*` as the row count; the
history summary uses the frontend computeAggregate semantics, which DO coerce. A baseline compared against a
current value computed differently would be wrong. Driver brief: decide in design how current and baseline stay
comparable (same source/reducer for both); if aligning extractMetric changes behaviour for existing alerts, that
is a product call and must be escalated.

## Scope

- An alert condition of the form `{baseline: "previous"|"rolling_avg", n, comparator, threshold, mode: "abs"|"pct"}`,
  read from output history.
- It EXCLUDES the current triggering run, because alert evaluation runs concurrently with the snapshot and history
  write in `PipelineRunService.onUnblockedRunSuccess`.
- AlertRuleService validates baseline conditions.

## Acceptance Criteria

- Red/green for previous and rolling-average breach and resolve.
- Empty history → no breach.
- A malformed baseline → 400 from AlertRuleService (create and update).
- A test proves the current run is excluded from the baseline.
- API-only (alerts have no UI or MCP). Update schemas if the condition shape is schema'd (it is:
  `schemas/alerts/*alert-rule*.schema.json`).

## Touches

services/alerts/AlertEvaluationService.scala, AlertRuleService.scala; minimal ApiRoutes wiring; schemas/alerts.
No migration. Stay out of HEL-1272 (PipelineSchedulerService, Main.scala) and HEL-1273 (OutputRoutes,
OutputService, PublicDashboardRoutes).
