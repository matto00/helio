## ADDED Requirements

### Requirement: POST /api/sources supports optional fieldOverrides
`POST /api/sources` SHALL accept an optional `fieldOverrides` array in the JSON body. Each override is `{ "name": string, "displayName": string, "dataType": string }`. When provided, the inferred `DataField` vector is updated before the `DataType` is inserted: for each field whose `name` matches an override, `displayName` and `dataType` are replaced with the override values. Non-matching fields are left unchanged.

#### Scenario: Override is applied to matching field
- **WHEN** `POST /api/sources` is called with `fieldOverrides: [{ "name": "revenue", "displayName": "Total Revenue", "dataType": "float" }]`
- **THEN** the created `DataType` contains a field named `revenue` with `displayName = "Total Revenue"` and `dataType = "float"`

#### Scenario: Non-matching overrides are ignored
- **WHEN** `fieldOverrides` contains an entry whose `name` does not match any inferred field
- **THEN** the override is silently ignored and the created `DataType` is unaffected

#### Scenario: Absent fieldOverrides leaves inferred schema unchanged
- **WHEN** `POST /api/sources` is called with no `fieldOverrides` property
- **THEN** the created `DataType` reflects the raw inferred schema

### Requirement: POST /api/data-sources supports optional fieldOverrides via multipart
`POST /api/data-sources` SHALL accept an optional `fields` multipart part containing a JSON-encoded `Vector[FieldOverridePayload]`. Parsing failures are silently ignored (treated as no overrides). If provided and parseable, overrides are applied to the inferred `DataField` vector before `DataType` insertion, using the same matching logic as `POST /api/sources`.

#### Scenario: CSV field override is applied
- **WHEN** `POST /api/data-sources` is called with a CSV file and a `fields` part containing `[{ "name": "value", "displayName": "Sale Value", "dataType": "float" }]`
- **THEN** the created `DataType` contains a field named `value` with `displayName = "Sale Value"`
