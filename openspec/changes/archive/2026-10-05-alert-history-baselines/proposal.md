## Why

Alert rules can only compare the latest value against a fixed threshold. With L1's per-Output history
(`output_snapshot_history`) a rule can now say "fire when this run is 20% below the previous run" or "more than 50
above the 5-run rolling average" — the HEL-918 epic's alert-baseline leaf (owner ruling D10).

## What Changes

- New optional condition keys on alert rules: `baseline` (`previous` | `rolling_avg`), `n` (rolling_avg only),
  `mode` (`abs` | `pct`), alongside the existing `comparator`/`threshold`. The comparator/threshold now apply to the
  delta between the current value and the baseline.
- Evaluation reads the baseline from output history, always excluding the triggering run's own history point.
- Current and baseline values for a baseline rule are both computed by the history summary reducer, so they are
  comparable. Plain threshold rules are unchanged.
- `POST`/`PATCH /api/alert-rules` reject a malformed baseline condition with 400.
- Alert-rule JSON schemas document the new keys.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `alert-evaluation-engine`: adds history-baseline condition evaluation.
- `alert-rule-crud-api`: adds baseline-condition validation (400 on malformed).

## Impact

- `backend/.../services/alerts/AlertEvaluationService.scala`, `AlertRuleService.scala`, a new pure helper in
  `services/alerts`; one constructor argument wired in `ApiRoutes.scala`.
- `schemas/alerts/{alert-rule,create-alert-rule-request,update-alert-rule-request}.schema.json`.
- No migration, no frontend, no MCP.

## Non-goals

- Changing `extractMetric` or any existing threshold rule's behaviour.
- Time-window baselines (`1d`/`7d`, D6) for alerts, alert UI, MCP tools, retention (L2), read API (L3).
