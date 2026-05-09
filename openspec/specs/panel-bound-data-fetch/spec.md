# panel-bound-data-fetch Specification

## Purpose
Defines how bound panels fetch and display data from their backing DataType on mount and on binding changes. All panel data fetches go through `GET /api/panels/:id/query` (the paginated execute endpoint); the frontend does not call DataSource preview endpoints directly from panel rendering contexts.
## Requirements
### Requirement: Bound panel fetches data through the execute endpoint on mount
When a panel has a non-null `typeId`, the frontend SHALL dispatch `fetchPanelPage` which calls `GET /api/panels/:id/query` on component mount. The `pageSize` SHALL be `200` for chart panels, `50` for table panels, and `10` for all other panel types (e.g. metric). The DataSource is not accessed directly; the backend resolves `typeId → DataType → DataSource` internally.

#### Scenario: Metric panel dispatches fetchPanelPage with pageSize 10 on mount
- **WHEN** a panel with `type: "metric"` and a non-null `typeId` is rendered
- **THEN** `GET /api/panels/:id/query?page=0&pageSize=10` is called once on mount

#### Scenario: Chart panel dispatches fetchPanelPage with pageSize 200 on mount
- **WHEN** a panel with `type: "chart"` and a non-null `typeId` is rendered
- **THEN** `GET /api/panels/:id/query?page=0&pageSize=200` is called once on mount

#### Scenario: Table panel dispatches fetchPanelPage with pageSize 50 on mount
- **WHEN** a panel with `type: "table"` and a non-null `typeId` is rendered
- **THEN** `GET /api/panels/:id/query?page=0&pageSize=50` is called once on mount

#### Scenario: Unbound panel does not fetch
- **WHEN** a panel with `typeId: null` is rendered
- **THEN** no execute fetch is made

### Requirement: Bound panel re-fetches when binding changes
When a panel's `typeId` or `fieldMapping` changes, the frontend SHALL re-fetch data to reflect the updated binding.

#### Scenario: Re-fetch on typeId change
- **WHEN** a panel's `typeId` is updated (e.g., after saving the Data tab)
- **THEN** the panel fetches fresh data for the new DataType via the execute endpoint

### Requirement: fieldMapping is applied to route fetched values to display slots
After a successful fetch, the hook SHALL apply `fieldMapping` to extract per-slot display values from the first row of the execute response. The result SHALL be a `Record<string, string>` keyed by slot name (e.g., `value`, `label`, `unit` for metric panels).

#### Scenario: Metric panel maps value slot
- **WHEN** execute data is fetched and `fieldMapping = { "value": "price" }`
- **THEN** the mapped data object has `{ value: <row's price field> }`

#### Scenario: Missing mapping slot yields empty string
- **WHEN** a slot key is not present in `fieldMapping`
- **THEN** the display value for that slot is an empty string

#### Scenario: Execute returns zero rows yields no-data state
- **WHEN** the execute endpoint returns an empty rows array
- **THEN** the panel shows a "No data available" message and no error

### Requirement: Loading state is shown while data is in flight
While an execute fetch is pending, the panel SHALL display a loading spinner in place of the panel body.

#### Scenario: Spinner shown during fetch
- **WHEN** a bound panel is mounted and the execute fetch has not yet completed
- **THEN** a loading spinner is visible in the panel body

### Requirement: Error state is shown if the fetch fails
If the execute fetch returns an error or the network request fails, the panel SHALL display a clear error message in the panel body.

#### Scenario: Error message on fetch failure
- **WHEN** the execute fetch returns a non-2xx response or throws a network error
- **THEN** an error message is displayed in the panel body (e.g., "Failed to load data")

#### Scenario: Error state does not crash other panels
- **WHEN** one panel's fetch fails
- **THEN** other panels on the dashboard render normally

### Requirement: DataSource is not directly accessible from panel rendering code
The `sources` Redux slice SHALL NOT be read in panel rendering contexts. All data resolution from DataType to DataSource is handled server-side by the execute endpoint. Frontend panel components and hooks MUST NOT traverse `dataType.sourceId` to reach a DataSource.

#### Scenario: Panel hook does not import or read sources slice
- **WHEN** `usePanelData` is invoked
- **THEN** it dispatches `fetchPanelPage` and reads from `panelsSlice.paginationState`; it does not access `sourcesSlice` state

### Requirement: Panel query endpoint is the canonical structured query representation
The `GET /api/panels/:id/query` endpoint SHALL be the single data-fetch path for all bound panels. `PATCH /api/panels/:id` SHALL NOT accept a `dataSourceId` field; any such attempt SHALL be rejected with `400 Bad Request` (the schema uses `additionalProperties: false` and does not include `dataSourceId`).

#### Scenario: PATCH with dataSourceId is rejected
- **WHEN** `PATCH /api/panels/:id` is called with a `dataSourceId` field
- **THEN** the response is `400 Bad Request`
