## MODIFIED Requirements

### Requirement: Bound panel fetches preview data on mount
When a panel has a non-null `typeId`, the frontend SHALL fetch preview data from the DataType's
backing source on component mount. The appropriate endpoint SHALL be selected based on panel type and
`DataSource.sourceType`:
- For panels with `type === "table"`, data SHALL be fetched via `GET /api/panels/:id/execute`
  with default pagination (`page=0`, `pageSize=50`), and rows SHALL be stored in `paginationState`.
- For panels with `type === "chart"`, the CSV preview fetch SHALL include `?limit=200` to retrieve
  enough data points for a meaningful chart.
- For all other panel types (`metric`, etc.) using CSV sources, the preview endpoint SHALL be used
  without a limit parameter.
- For REST API sources, `GET /api/sources/:id/preview` continues to be used for all non-table panel
  types.

#### Scenario: CSV-backed panel triggers CSV preview fetch on mount
- **WHEN** a panel with a non-null `typeId` and `type !== "table"` is rendered and the DataType's
  source has `sourceType: "csv"`
- **THEN** `GET /api/data-sources/:sourceId/preview` is called once on mount

#### Scenario: REST API-backed panel triggers REST preview fetch on mount
- **WHEN** a panel with a non-null `typeId` and `type !== "table"` is rendered and the DataType's
  source has `sourceType: "rest_api"`
- **THEN** `GET /api/sources/:sourceId/preview` is called once on mount

#### Scenario: Table panel uses execute endpoint on mount
- **WHEN** a panel with `type === "table"` and a non-null `typeId` is rendered
- **THEN** `GET /api/panels/:panelId/execute?page=0&pageSize=50` is called on mount and
  `fetchPanelPage` is dispatched

#### Scenario: Unbound panel does not fetch
- **WHEN** a panel with `typeId: null` is rendered
- **THEN** no preview fetch is made

#### Scenario: Panel with no sourceId does not fetch
- **WHEN** a panel's bound DataType has `sourceId: null`
- **THEN** no preview fetch is made and the panel renders as unbound

#### Scenario: Chart panel fetches CSV preview with limit=200
- **WHEN** a panel with `type: "chart"` and a CSV-backed DataType is rendered
- **THEN** `GET /api/data-sources/:sourceId/preview?limit=200` is called

#### Scenario: Non-chart, non-table panel fetches CSV preview without limit
- **WHEN** a panel with `type` other than `"chart"` or `"table"` (e.g. `"metric"`) and a
  CSV-backed DataType is rendered
- **THEN** `GET /api/data-sources/:sourceId/preview` is called without a `limit` parameter
