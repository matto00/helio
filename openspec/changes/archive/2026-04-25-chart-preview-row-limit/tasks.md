## 1. Backend

- [x] 1.1 Add `?limit=N` query param extraction in `DataSourceRoutes.scala` preview route, clamped to 1–500
- [x] 1.2 Pass extracted limit to `SchemaInferenceEngine.parseCsvRows` (replace hardcoded `maxRows = 10`)

## 2. Frontend

- [x] 2.1 Update `fetchCsvPreview` in `dataSourceService.ts` to accept an optional `limit` argument and append `?limit=N` when provided
- [x] 2.2 Update `usePanelData` to pass `limit=200` to `fetchCsvPreview` when `panel.type === "chart"`

## 3. Tests

- [x] 3.1 Update `DataSourceRoutesSpec` to verify `?limit=200` returns 200 rows and default (no param) returns 10
- [x] 3.2 Update `usePanelData.test.ts` to assert chart panels call `fetchCsvPreview` with `limit=200` and non-chart panels call without limit
