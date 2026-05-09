## MODIFIED Requirements

### Requirement: Bound panel fetches preview data on mount
When a panel has a non-null `typeId`, the frontend SHALL fetch data by dispatching to
`GET /api/panels/:id/query` (the execute endpoint) via the `fetchPanelPage` thunk.
The frontend SHALL NOT call `/api/data-sources/:id/preview` or `/api/sources/:id/preview`
directly from panel rendering code. The `pageSize` parameter SHALL be set to 200 for
`chart` panels and 10 for all other panel types. The `usePanelData` hook SHALL NOT
resolve `dataType.sourceId` or depend on the Redux `sources` slice.

#### Scenario: Bound panel triggers execute endpoint on mount
- **WHEN** a panel with a non-null `typeId` is rendered
- **THEN** `GET /api/panels/:id/query?page=0&pageSize=N` is dispatched once on mount via `fetchPanelPage`

#### Scenario: Chart panel uses pageSize 200
- **WHEN** a panel with `type: "chart"` and a non-null `typeId` is rendered
- **THEN** `fetchPanelPage` is called with `pageSize: 200`

#### Scenario: Non-chart panel uses pageSize 10
- **WHEN** a panel with a type other than `"chart"` (e.g. `"metric"`, `"table"`) and a non-null `typeId` is rendered
- **THEN** `fetchPanelPage` is called with `pageSize: 10`

#### Scenario: Unbound panel does not fetch
- **WHEN** a panel with `typeId: null` is rendered
- **THEN** no execute fetch is made

#### Scenario: Panel with no sourceId does not fetch
- **WHEN** a panel's bound DataType has `sourceId: null`
- **THEN** the execute endpoint returns an appropriate error and the panel renders as unbound

### Requirement: Bound panel re-fetches when binding changes
When a panel's `typeId` or `fieldMapping` changes, the frontend SHALL re-fetch data
to reflect the updated binding.

#### Scenario: Re-fetch on typeId change
- **WHEN** a panel's `typeId` is updated (e.g., after saving the Data tab)
- **THEN** the panel dispatches a fresh `fetchPanelPage` for the new binding

### Requirement: fieldMapping is applied to route fetched values to display slots
After a successful execute fetch, the hook SHALL apply `fieldMapping` to extract per-slot
display values from the first row of the query result. The result SHALL be a
`Record<string, string>` keyed by slot name (e.g., `value`, `label`, `unit` for metric panels).

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
While an execute fetch is pending, the panel SHALL display a loading spinner in place of
the panel body.

#### Scenario: Spinner shown during fetch
- **WHEN** a bound panel is mounted and the execute fetch has not yet completed
- **THEN** a loading spinner is visible in the panel body

### Requirement: Error state is shown if the fetch fails
If the execute fetch returns an error or the network request fails, the panel SHALL display
a clear error message in the panel body.

#### Scenario: Error message on fetch failure
- **WHEN** the execute fetch returns a non-2xx response or throws a network error
- **THEN** an error message is displayed in the panel body (e.g., "Failed to load data")

#### Scenario: Error state does not crash other panels
- **WHEN** one panel's fetch fails
- **THEN** other panels on the dashboard render normally

## REMOVED Requirements

### Requirement: Panel query endpoint is the canonical structured query representation
**Reason**: Superseded — `GET /api/panels/:id/query` is now the only data-fetch path for
panel rendering, not a coexistent alternative. The description of "coexistence" with preview
endpoints no longer applies to panel rendering code.
**Migration**: All panel rendering now uses `fetchPanelPage` (execute endpoint) exclusively.
The DataSource preview endpoints remain available for other purposes (e.g. source preview
on the Sources page) but are not called from `usePanelData`.
