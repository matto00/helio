## Why

Durations stored as seconds (a CI job of 330 s) render as a bare number. Authors work around it by precomputing
`*_label` text columns upstream, which also breaks numeric sort and threshold rules on that column (HEL-1308).

## What Changes

- New display format `duration` for metric and collection Outputs (`config.format`), with a milliseconds variant
  `durationMs`, rendering compact text: 330 -> "5m 30s", 0 -> "0s", 45 -> "45s", 3725 -> "1h 2m", 90061 -> "1d 1h".
- New table column format type `duration` (`config.columnFormats[col] = { type: "duration", unit?: "s" | "ms" }`).
- Both selectable in the Output editor (metric/collection Format select; table column Format select offers seconds and
  milliseconds).
- Metric history delta ("vs previous") reuses the same formatter, so a duration metric's delta reads "1m 5s".
- Null and non-numeric values fall back exactly like the existing formats.
- The format vocabulary (all metric/collection `format` values and table column format types, including `duration`)
  is documented in the backend `KeysDoc`, the Output request JSON schemas and helio-mcp `OUTPUT_CONFIG_KEYS_DOC`, so
  agent-authored config can use it. Backend tests pin that `duration` configs are accepted and round-trip unchanged.

## Non-goals

- No backend value validation of `format`/`columnFormats` (none exists today for any value; adding it could reject
  stored legacy configs -- a separate decision).
- No locale-translated unit words; no week/month/year units; no clock style ("01:23:00").
- No chart-axis duration formatting.
- No change to conditional-format rule evaluation (rules already compare the raw value).
- No migration.

## Capabilities

### New Capabilities
- `output-duration-format`: duration display format for metric, collection and table-column values, its editor
  selection, fallback behaviour and its documentation on the server/agent surfaces.

### Modified Capabilities

## Impact

- Frontend: `outputConfigTypes.ts`, `MetricRenderer.tsx` (`formatMetricValue`), `columnFormatting.ts`,
  `TableRenderer.tsx` (alignment), `OutputKindFields.tsx`, `TableDisplayFields.tsx`, `useOutputColumnFormats.ts`; a new pure `formatDuration` helper. (`buildOutputConfig.ts` and `HistorySummary.tsx` need no
  change: they already pass `columnFormats` through / call `formatMetricValue`.)
- Backend: `OutputConfigValidation.KeysDoc` text (one appended sentence) and a new `OutputFormatVocabulary` doc object; tests.
- Schemas: `create-output-request`, `update-output-request`, `create-pipeline-transactional-output-request` descriptions.
- helio-mcp: `OUTPUT_CONFIG_KEYS_DOC` and its test pin.
- Shared seam fixture under `shared-test-fixtures/`.
