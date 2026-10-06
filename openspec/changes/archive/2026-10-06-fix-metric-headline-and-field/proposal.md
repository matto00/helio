## Why

Two metric-correctness bugs from HEL-1275 (L5), verified against main at 0614c979, re-verified at cdb9e43d6. Under any server-applied viewer
filter the metric headline is aggregated client-side over only the first 200 loaded rows. Separately, the metric
field resolver (server `OutputSummaryReducer.metric` and its client port `resolveServerMetricField`) takes a lone
`fieldMapping` entry even when that entry is `label`/`unit`. This includes the editor's common aggregated-metric
shape (`fieldMapping: {label}` + `aggregation: {value, agg}`), which then aggregates the label column: `sum` stores
`0`, `count` stores the label count.

## What Changes

- The metric field resolution rule becomes `fieldMapping.value`, then `aggregation.value`, on both server and client.
  A `label`/`unit` mapping is never the metric field. With neither present, the metric resolves to `null`.
- `GET /api/outputs/:id/rows` and the public `.../panels/:panelId/rows` return the metric value computed over the
  FULL filtered set for a metric Output when a filter is applied (page 0 only).
- The metric panel headline under a server-applied filter shows that full-filtered-set value.
- A cross-filter applied client-side to a truncated load cannot be computed over the full set; it keeps the loaded-rows
  value, labelled by the existing HEL-588 "N of M loaded rows match." disclosure (owner ruling D5
  `existing-disclosure`; no new copy).
- History `current`/`baseline` points expose their stored metric identity (additive); the panel hides a delta whose
  baseline came from a different field/agg, wherever the baseline lies. No data migration (design.md D4).

## Capabilities

### New Capabilities

### Modified Capabilities
- `metric-history-delta-ui`: the filtered headline is the full-filtered-set value, not the loaded rows.
- `output-snapshot-history`: the metric field selection never picks a `label`/`unit` mapping.
- `output-routes-api`: the rows responses carry the filtered metric value for metric Outputs.
- `output-history-api`: resolved points carry their stored metric identity (additive; selection unchanged).

## Impact

- Backend: `OutputSummaryReducer`, `OutputService.rows`, `PublicPanelRowsResolver.resolveRows` (public rows, split out by
  HEL-1291) + new `PublicPanelRowsResponse` under `api/protocols/**`, `NodeSnapshotRepository`
  (a projected filtered read), history response case classes (additive identity), rows response JSON.
- Contracts: `schemas/outputs/output-rows-response.schema.json`, both history response schemas; new public panel rows
  response schema.
- Frontend: `metricHistoryView.ts`, `MetricOutputPanel.tsx`, the panel row-fetch plumbing (`panelThunks`/`panelsSlice`,
  `usePublicPanelData`).
- No migration. No change to alert evaluation (L8 reads `columns`, not `metric`).

## Non-goals

- Backfilling or rewriting existing `output_snapshot_history` rows: owner ruled `no-backfill` (no V117); the residual
  on raw API/MCP values is stated in the PR.
- Pipeline-editor preview (`OutputPreviewPane`), history scrubber (L7), delta colour semantics (HEL-1329).
