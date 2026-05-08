## MODIFIED Requirements

### Requirement: PanelQuery is derived from a panel's fieldMapping
The system SHALL define a `PanelQuery` domain model with fields: `selectedFields` (list of field names),
`filters` (list of filter expressions as `JsValue`), `sort` (optional sort expression string), and
`limit` (optional integer). `PanelQuery` SHALL be derived from a `Panel`'s `fieldMapping` at request
time — it is not persisted separately. For panels with `typeId: None`, no query can be derived.
All four fields (`selectedFields`, `filters`, `sort`, `limit`) SHALL be actively applied as Spark
DataFrame operations when executed via `PanelQueryExecutor` — none are no-ops.

#### Scenario: Bound panel produces a PanelQuery with selectedFields from fieldMapping values
- **WHEN** a `Panel` has a non-null `typeId` and `fieldMapping = { "value": "price", "label": "name" }`
- **THEN** `buildQuery` returns a `PanelQuery` where `selectedFields = ["price", "name"]`

#### Scenario: Panel with null typeId produces no query
- **WHEN** a `Panel` has `typeId: None`
- **THEN** `buildQuery` returns `None`

#### Scenario: Panel with null fieldMapping produces query with empty selectedFields
- **WHEN** a `Panel` has a non-null `typeId` but `fieldMapping: None`
- **THEN** `buildQuery` returns a `PanelQuery` where `selectedFields` is empty

#### Scenario: Non-object fieldMapping produces query with empty selectedFields
- **WHEN** a `Panel` has a non-null `typeId` and `fieldMapping` is a JSON array or scalar
- **THEN** `buildQuery` returns a `PanelQuery` where `selectedFields` is empty
