## Why

HEL-921 renders narrative insights for `insight` Outputs (L1 registered the kind; L3 built the pack/validator behind a
fake model seam). Rendered text has nowhere to live: `node_snapshots` and `output_snapshot_history.summary` cannot hold
markdown, citations or per-render cost. L4 (triggers) and L5 (panel UI) both need a store and a read API first.

## What Changes

- V145 adds `output_insights`: one row per render attempt (ok, failed, or skipped), keyed to the Output with
  `ON DELETE CASCADE`, sharing-aware RLS on `helio_can_access_pipeline(pipeline_id)` (V115 pattern) and an explicit
  `helio_privileged` grant. `RlsPolicyGuardSpec.rlsTables` gains the table.
- `OutputInsightRepository`: insert (for L4 and tests), latest-ok, latest-attempt, recent-history reads, retention purge.
- `OutputInsightReadService`: read-only, constructed without any model client (proved by a constructor-shape guard).
- `GET /api/outputs/:id/insight` (latest good render + last attempt status, authenticated grantees).
- `GET /api/outputs/:id/insight/history?limit=&since=` (newest first, every attempt).
- Public `GET /api/dashboards/:d/panels/:p/insight`: allow-listed projection only (no cost, model, token, run-id,
  digest or cited Output ids).
- Retention: a third part of the existing scheduler-tick retention pass purges insight rows older than the pipeline
  owner's tier age, never the latest ok row or the latest attempt per Output.
- JSON schemas for the three responses; CLAUDE.md endpoint list + the stale `ANTHROPIC_API_KEY` row.

## Capabilities

### New Capabilities

- `insight-render-store`: the `output_insights` table, its read API (authenticated and public) and its retention.

### Modified Capabilities

(none)

## Non-goals

- Writing renders from a trigger, quota/budget gates, any model call (L4, HEL-1743).
- The per-Output `model` config key (L4, D1 amended).
- Any frontend: insight panel rendering, footer and refresh button, `role="status"` on `InsightNotRenderedState`
  (L5, HEL-1744).
- Ask-your-data (L6/L7), MCP tools (L8).

## Impact

Backend: migration V145, persistence, services, `OutputRoutes`, `PublicDashboardRoutes` (+ a resolver), protocols,
`Main` wiring, `OutputHistoryRetentionService`. Schemas under `schemas/outputs/`. CLAUDE.md. No frontend change.
