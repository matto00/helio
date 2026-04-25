## Why

The preview endpoint is hardcoded to return 10 rows, which was sufficient for
table/metric panels but produces charts with too few data points to be useful.
Chart panels need 200–500 rows to render meaningful visualizations.

## What Changes

- Add a `?limit=N` query parameter to `GET /api/data-sources/:id/preview` so
  callers can request more rows (capped server-side at 500)
- The frontend `ChartPanel` passes `limit=200` when fetching preview data
- Table and metric panels continue to use the default (10 rows), unchanged
- The server cap (500) prevents memory/timeout issues for large CSVs

## Capabilities

### New Capabilities

- `chart-preview-row-limit`: `GET /api/data-sources/:id/preview` accepts an
  optional `?limit=N` query parameter (1–500); the frontend chart data hook
  passes `limit=200` for chart panels; all other panel types omit the param
  and continue to receive the existing default row count

### Modified Capabilities

- `panel-bound-data-fetch`: The preview fetch hook gains an optional `limit`
  parameter that chart panels use to request more rows

## Non-goals

- Pagination of preview data
- Streaming or chunked transfer of large data sets
- Changing behaviour for REST API data sources (only CSV preview is affected)

## Impact

- Backend: `DataSourceRoutes` / `SchemaInferenceEngine.parseCsvRows` — add
  limit query param extraction and pass it through
- Frontend: `usePanelData` hook and/or service layer — pass `?limit=200` when
  the panel type is `"chart"`
- No DB migrations; no new endpoints; no breaking changes
