## Why

CSV blank cells reach every pipeline step as the string `""`, so `count`/`count_distinct` count them, `fillnull` never
fills them, and `is null` never matches them (HEL-1310). The owner ruled (2026-10-08) that a blank is null at ingest,
platform-wide, with SQL-NULL semantics, and settled eight follow-on product questions (all recommendations accepted).

## What Changes

- **BREAKING (behaviour)**: the CSV run-path reader turns an empty cell, a quoted-empty cell and a whitespace-only cell
  into null; padded (missing trailing) cells are null; fully blank lines are skipped instead of becoming a row.
  Non-blank cells are never trimmed.
- `filter` compat: `= ""` and `contains ""` also match null, `!= ""` also excludes null (drop-blank filters keep working).
- Cross-filter: clicking a blank (null) chart category filters siblings to their blank rows, client and server
  (server `eq ""` matches SQL NULL too).
- `analyzewithai`, `generatetext`, `convertformat`: a present-but-null input cell is treated as empty text (today's
  blank behaviour); an absent key still fails `field-missing`.
- Metric panel: the client-computed `count` over loaded rows excludes null, matching the server headline.
- Everything else follows from null semantics and is pinned by a regression suite: aggregate `count`/`count_distinct`,
  pivot `count`, `fillnull`, sort/window null-last, groupBy/pivot/dedupe keys, assert `notNull`/`unique`, cast,
  compute null propagation, join/lookup keys, upsert required columns, Output schema (date-like column with blanks
  infers timestamp), Output summary `count`, and table rendering (`—`).

## Capabilities

### New Capabilities
- `csv-blank-cell-null`: CSV run-path blank-cell normalization and the pinned downstream null semantics.

### Modified Capabilities
- `pipeline-filter-op`: `=`/`!=` against `""` treat null as blank.
- `pipeline-generatetext-op`: `field-missing` only for an absent input field.
- `pipeline-convertformat-op`: `field-missing` only for an absent field.

## Non-goals

- Schema inference, the CSV source preview and the first-run classifier (they read raw strings and already treat blanks
  as empty); every CSV column stays `string`.
- Typed sources (SQL/REST/dataset/static JSON) — they do not share the CSV reader.
- `convertformat`'s own csv→json text conversion (a text transform, not ingest).
- Re-materializing existing snapshots: stored `""` stays until each pipeline's next run.
- A `coalesce()` expression function and a `(blank)` category label (follow-up tickets).
- The HEL-1257 streaming reader (not merged); `SparkJobSubmitter`'s CSV reader (unreachable in production).

## Impact

Backend: `InProcessPipelineEngine` CSV loader, `FilterStep`, `AnalyzeWithAiStep`, `GenerateTextStep`,
`ConvertFormatStep`, `NodeSnapshotFilterSql` (`eq ""`). Frontend: `MetricOutputPanel` count, `chartClickSelection`.
Results also shift for row counts/asserts/alerts, upsert defaults, server table sort and the assistant's workspace
grounding (`WorkspaceContextComputations`). No migration, no API shape change.
