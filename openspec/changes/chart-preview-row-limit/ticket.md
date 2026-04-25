# HEL-71: Chart panel: increase preview row limit for meaningful visualization

## Description

### Context

The data source preview endpoint (`GET /api/data-sources/:id/preview`) is hardcoded to return 10 rows (`maxRows = 10` in `SchemaInferenceEngine.parseCsvRows`). This was fine for table panel previews, but chart panels need significantly more data points to render meaningful visualizations — 10 bars or line points gives very little signal.

Discovered during HEL-68 manual testing.

### What changes

* Increase the row limit for chart data: target 200–500 rows
* Options:
  * Add a `?limit=N` query parameter to the existing preview endpoint so callers can request more rows
  * Or add a dedicated chart data endpoint that returns more rows without affecting the table/metric preview UX

The frontend `ChartPanel` component already consumes `rawRows` and `headers` from `usePanelData`, so no frontend wiring changes are expected beyond passing the correct limit.

## Acceptance Criteria

- [ ] Chart panels render at least 200 rows of data when available
- [ ] Table and metric panels are unaffected (still receive a small preview)
- [ ] Large CSV sources (thousands of rows) do not cause timeout or memory issues at the new limit
