## Why

An Output's `config` is free-form JSONB: the backend validates only `fieldMapping` slot names, `compare` and
`historyPayloads`, so a typo'd key (or a key the renderer never reads) is stored and silently ignored. API/MCP callers
need read-back assertions to discover their write did nothing (helio-news `build.py`). The same hole lets a malformed
or inapplicable chart `aggregation` be stored and silently ignored on the dashboard, even though HEL-1351 now applies a
well-formed one.

## What Changes

- Every Output config write path (create, PATCH after merge, single-call pipeline create, proposal grounding,
  patch-set preview/apply) rejects a key outside the Output kind's known-key set with `400` naming the key(s), with a
  did-you-mean hint (nearest known key, or a rename hint for known legacy keys).
- Tolerance (AC3): reads never validate; a write may re-send a stored unknown key with its stored value unchanged
  (read-modify-write round trips and patch-set rollback keep working); only *introducing or changing* an unknown key
  is rejected. No data migration.
- `aggregation` is validated by kind when written: chart `{groupBy, agg, yField}` (all non-empty, agg in
  count|sum|avg|min|max), metric `{value, agg}`, `null` always allowed; any other kind, shape, or a non-null
  aggregation on a `scatter` chart is a `400` with a clear message. `chartType` must be bar|line|pie|scatter.
- **BREAKING (API/MCP)**: the dead partial-merge of `legend`/`tooltip`/`seriesColors`/`axisLabels` is removed; those
  keys were never read by any renderer and are now unknown keys (chart styling lives on panel `appearance.chart`).
- Output editor stops storing an aggregation on a scatter chart.
- helio-mcp tool docs and `schemas/` describe the per-kind keys and the aggregation shapes.

## Capabilities

### New Capabilities

### Modified Capabilities
- `output-routes-api`: config key + aggregation validation on every write; partial-merge requirement no longer
  deep-merges the four dead sub-objects.
- `mcp-output-tools`: Output config write tools (incl. `apply_patch_set`) document the per-kind key set and shapes.
- `assistant-conversation-loop`: in-app assistant Output-config surfaces carry the key set from the validator's table.

## Impact

Backend `OutputService` (validateConfig, mergeConfig), a new pure validator object beside it, `PipelineService`
single-call/proposal validator, `PatchSetPreviewProjection`; frontend `buildOutputConfig.ts`; `schemas/outputs/*`,
`schemas/pipelines/create-pipeline-transactional-output-request.schema.json`; `helio-mcp/src/tools/*` docs.

## Non-goals

- Rewriting stored legacy keys (V94 `metricLabel` etc.) — tolerated, not migrated; follow-up.
- Validating value types of keys other than `aggregation`/`chartType` (existing `compare`/`historyPayloads`/
  `fieldMapping` checks unchanged).
- Panel `appearance.chart.chartType` forcing scatter over an aggregated Output (panel-level, not Output config).
- The "Add as tail with aggregate" chart path writing invalid `fieldMapping` slots (pre-existing, separate defect).
