## Why

Metrics are now reused across dashboards (HEL-500/549/553), but nothing tracks who's using one, a
deprecated metric is still offered everywhere as if active, and deleting a metric gives no warning
about what it will unbind. This closes those gaps so reuse stays safe and observable.

## What Changes

- New `GET /api/metrics/:id/usage` route (owner-scoped): panels + dashboards bound to a metric, via a
  `MetricRepository` query mirroring `DataTypeRepository.existsBoundToAnyOwnedPanel`'s join.
- `DELETE /api/metrics/:id` stays `204` (no breaking body change) but gains an additive
  `X-Unbound-Panel-Count` header. The frontend's delete-confirm affordance calls the usage endpoint on
  click to show the real count first, replacing today's generic copy.
- `helio-mcp/src/context.ts`'s grounding catalog (`buildWorkspaceContext`'s `metrics`, HEL-549) now
  **excludes** deprecated metrics by default — already-shipped behavior change (doc-comment says the
  opposite today; both change together). `list_metrics` is unaffected.
- The metric picker (`MetricPicker.tsx`, HEL-553) excludes deprecated metrics from new selections,
  except a panel's already-bound metric stays visible.
- A panel bound to a now-deprecated metric shows a "deprecated" indicator in its binding editor (reuses
  `MetricListTable.tsx`'s badge), backed by a new always-computed `metricDeprecated` read-time field.
- Test-only: prove a rename reflects on bound panels with no re-binding (already true —
  materialization reads the live `MetricDefinition` every read).

## Capabilities

### New Capabilities

- `metric-usage-governance`: the "where used" query and delete-impact communication.

### Modified Capabilities

- `mcp-metric-tools`: grounding catalog excludes deprecated metrics.
- `panel-datatype-binding`: picker excludes deprecated (with the bound-metric exception); read response
  gains `metricDeprecated`; binding editor surfaces the indicator.
- `metric-authoring-ui`: delete confirmation shows the real, live usage count.
- `metric-crud-api`: delete response gains the `X-Unbound-Panel-Count` header.

## Impact

- Backend: `MetricRepository`/`MetricRoutes`/`MetricService` — no migration needed (`panels.metric_id`
  + index already exist from HEL-500).
- `helio-mcp/src/context.ts`, `frontend/src/features/{metrics,panels}/**`.
- Non-goals: a standalone "usage list" page; a dashboard-grid card badge (editor only); MCP
  `delete_metric` changes (header is additive, not required by any AC here).
