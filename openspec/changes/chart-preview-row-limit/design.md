## Context

`GET /api/data-sources/:id/preview` is implemented in `DataSourceRoutes.scala` (line 250).
It calls `SchemaInferenceEngine.parseCsvRows(csv, maxRows = 10)` with a hardcoded 10-row
limit. The frontend service `fetchCsvPreview(sourceId)` issues a plain GET with no params.
`usePanelData` calls `fetchCsvPreview` for CSV/static sources; chart panels use `rawRows`
from this hook to drive ECharts series data.

## Goals / Non-Goals

**Goals:**
- Backend: accept optional `?limit=N` (1–500) on the preview endpoint; default stays 10
- Frontend: `fetchCsvPreview` accepts an optional `limit` argument; `usePanelData` passes
  `limit=200` when `panel.type === "chart"`

**Non-Goals:**
- Changing behaviour for REST API or SQL data sources
- Pagination or streaming
- Altering the static-data branch (rows come from config, not parsed CSV)

## Decisions

**D1: Query param on existing endpoint, not a new endpoint.**
A new endpoint would require routing boilerplate, OpenAPI additions, and ACL wiring that
already exists on the preview route. Adding `?limit=N` is strictly additive and backward
compatible — callers that omit it get the existing 10-row default.

**D2: Server-side cap at 500 rows.**
The acceptance criteria target "200–500 rows". Capping server-side at 500 prevents a
caller from requesting an unbounded amount. 500 rows × ~50 bytes/row = 25 KB — well
within a normal HTTP response; no streaming or chunked transfer needed.

**D3: Default limit stays 10 (not changed).**
Table and metric panels already work correctly at 10 rows and must remain unaffected.
The only callers that need more rows pass `limit=200` explicitly.

**D4: `usePanelData` detects panel type to pick limit.**
`panel.type` is already available in the hook. This avoids threading a new prop through
component trees. Chart panels pass `limit=200`; all others omit the param.

**D5: `fetchKey` in `usePanelData` does not need to encode `limit`.**
The limit is derived solely from `panel.type`, which is stable for the lifetime of a
panel. If `panel.type` ever changed (not currently possible) a re-render would occur
naturally. No deduplication key change is needed.

## Risks / Trade-offs

- [Static-data branch] `CsvPreviewResponse` is returned directly from the config; `limit`
  is silently ignored. This is acceptable — static sources have a small, user-defined row
  count and do not parse a CSV file. → No mitigation needed; document in code comment.
- [Large CSV files] Reading the full file into memory before slicing is already done today.
  500 rows still takes < 1 ms to slice from a 10 000-row CSV. → No change required.

## Planner Notes

Self-approved: no new dependencies, no breaking API changes, no DB migrations, no new
endpoints, minimal blast radius. The change is additive and purely internal to two files
on each layer.
