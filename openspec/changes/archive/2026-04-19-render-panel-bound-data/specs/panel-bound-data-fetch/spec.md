## ADDED Requirements

### Requirement: Bound panel fetches preview data on mount
When a panel has a non-null `typeId`, the frontend SHALL fetch preview data from the DataType's backing source on component mount. The appropriate endpoint SHALL be selected based on `DataSource.sourceType`: `GET /api/data-sources/:id/preview` for CSV sources and `GET /api/sources/:id/preview` for REST API sources.

#### Scenario: CSV-backed panel triggers CSV preview fetch on mount
- **WHEN** a panel with a non-null `typeId` is rendered and the DataType's source has `sourceType: "csv"`
- **THEN** `GET /api/data-sources/:sourceId/preview` is called once on mount

#### Scenario: REST API-backed panel triggers REST preview fetch on mount
- **WHEN** a panel with a non-null `typeId` is rendered and the DataType's source has `sourceType: "rest_api"`
- **THEN** `GET /api/sources/:sourceId/preview` is called once on mount

#### Scenario: Unbound panel does not fetch
- **WHEN** a panel with `typeId: null` is rendered
- **THEN** no preview fetch is made

#### Scenario: Panel with no sourceId does not fetch
- **WHEN** a panel's bound DataType has `sourceId: null`
- **THEN** no preview fetch is made and the panel renders as unbound

### Requirement: Bound panel re-fetches when binding changes
When a panel's `typeId` or `fieldMapping` changes, the frontend SHALL re-fetch preview data to reflect the updated binding.

#### Scenario: Re-fetch on typeId change
- **WHEN** a panel's `typeId` is updated (e.g., after saving the Data tab)
- **THEN** the panel fetches fresh preview data for the new DataType

### Requirement: fieldMapping is applied to route fetched values to display slots
After a successful fetch, the hook SHALL apply `fieldMapping` to extract per-slot display values from the first row of the preview response. The result SHALL be a `Record<string, string>` keyed by slot name (e.g., `value`, `label`, `unit` for metric panels).

#### Scenario: Metric panel maps value slot
- **WHEN** preview data is fetched and `fieldMapping = { "value": "price" }`
- **THEN** the mapped data object has `{ value: <row's price field> }`

#### Scenario: Missing mapping slot yields empty string
- **WHEN** a slot key is not present in `fieldMapping`
- **THEN** the display value for that slot is an empty string

#### Scenario: Preview returns zero rows yields no-data state
- **WHEN** the preview endpoint returns an empty rows array
- **THEN** the panel shows a "No data available" message and no error

### Requirement: Loading state is shown while data is in flight
While a preview fetch is pending, the panel SHALL display a loading spinner in place of the panel body.

#### Scenario: Spinner shown during fetch
- **WHEN** a bound panel is mounted and the preview fetch has not yet completed
- **THEN** a loading spinner is visible in the panel body

### Requirement: Error state is shown if the fetch fails
If the preview fetch returns an error or the network request fails, the panel SHALL display a clear error message in the panel body.

#### Scenario: Error message on fetch failure
- **WHEN** the preview fetch returns a non-2xx response or throws a network error
- **THEN** an error message is displayed in the panel body (e.g., "Failed to load data")

#### Scenario: Error state does not crash other panels
- **WHEN** one panel's fetch fails
- **THEN** other panels on the dashboard render normally
