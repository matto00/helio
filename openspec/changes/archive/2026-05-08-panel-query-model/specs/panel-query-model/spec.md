## ADDED Requirements

### Requirement: PanelQuery is derived from a panel's fieldMapping
The system SHALL define a `PanelQuery` domain model with fields: `selectedFields` (list of field names),
`filters` (list of filter expressions), `sort` (optional sort expression), and `limit` (optional integer).
`PanelQuery` SHALL be derived from a `Panel`'s `fieldMapping` at request time — it is not persisted separately.
For panels with `typeId: None`, no query can be derived.

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

### Requirement: GET /api/panels/:id/query returns the panel's structured query
The backend SHALL expose `GET /api/panels/:id/query` that returns the panel's current `PanelQuery` as JSON.
The endpoint SHALL require authentication and respect ACL checks consistent with other panel sub-routes.

#### Scenario: Bound panel returns PanelQuery JSON
- **WHEN** `GET /api/panels/:id/query` is called for a panel with a non-null `typeId`
- **THEN** the response is `200 OK` with a JSON body matching the `PanelQuery` schema

#### Scenario: Unbound panel returns 404
- **WHEN** `GET /api/panels/:id/query` is called for a panel with `typeId: null`
- **THEN** the response is `404 Not Found`

#### Scenario: Non-existent panel returns 404
- **WHEN** `GET /api/panels/:id/query` is called for a panel ID that does not exist
- **THEN** the response is `404 Not Found`

### Requirement: PanelQuery is serializable to JSON
`PanelQuery` SHALL have a Spray JSON format registered in `JsonProtocols` so it can be serialized
to/from JSON. The schema fields are: `selectedFields` (array of string), `filters` (array of object),
`sort` (nullable string), `limit` (nullable integer).

#### Scenario: PanelQuery serializes selectedFields as a JSON array of strings
- **WHEN** `PanelQuery(selectedFields = List("price", "name"), filters = Nil, sort = None, limit = None)` is marshalled
- **THEN** the JSON is `{ "selectedFields": ["price", "name"], "filters": [], "sort": null, "limit": null }`

#### Scenario: PanelQuery with limit serializes limit as integer
- **WHEN** `PanelQuery(selectedFields = List("qty"), filters = Nil, sort = None, limit = Some(100))` is marshalled
- **THEN** the JSON contains `"limit": 100`
