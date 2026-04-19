## MODIFIED Requirements

### Requirement: fieldMapping is applied to route fetched values to display slots
After a successful fetch, the hook SHALL apply `fieldMapping` to extract per-slot display values from the first row of the preview response. The result SHALL be a `Record<string, string>` keyed by slot name (e.g., `value`, `label`, `unit` for metric panels). Computed field values SHALL be available in the row alongside regular field values and MAY be used in `fieldMapping`.

#### Scenario: Metric panel maps value slot
- **WHEN** preview data is fetched and `fieldMapping = { "value": "price" }`
- **THEN** the mapped data object has `{ value: <row's price field> }`

#### Scenario: Computed field mapped to display slot
- **WHEN** preview data is fetched, the DataType has a computed field `total`, and `fieldMapping = { "value": "total" }`
- **THEN** the mapped data object has `{ value: <row's evaluated total> }`

#### Scenario: Missing mapping slot yields empty string
- **WHEN** a slot key is not present in `fieldMapping`
- **THEN** the display value for that slot is an empty string

#### Scenario: Preview returns zero rows yields no-data state
- **WHEN** the preview endpoint returns an empty rows array
- **THEN** the panel shows a "No data available" message and no error
