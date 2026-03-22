## ADDED Requirements

### Requirement: Panel can be bound to a DataType
A panel SHALL have optional `typeId` and `fieldMapping` properties. `typeId` references a registered DataType; `fieldMapping` is a JSON object mapping panel display slot names to DataType field names.

#### Scenario: Unbound panel has null typeId
- **WHEN** a panel is created without a typeId
- **THEN** `typeId` is `null` in the panel response

#### Scenario: Panel response includes typeId and fieldMapping
- **WHEN** a panel has been bound to a DataType
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `typeId` and `fieldMapping` populated

### Requirement: PATCH /api/panels/:id accepts typeId and fieldMapping
The existing `PATCH /api/panels/:id` endpoint SHALL accept optional `typeId` (string or null) and `fieldMapping` (object or null) fields. Passing `null` explicitly SHALL unbind the panel.

#### Scenario: Bind panel to type
- **WHEN** `PATCH /api/panels/:id` is called with `{ "typeId": "<valid-type-id>", "fieldMapping": { "value": "price" } }`
- **THEN** the response is 200 with `typeId` and `fieldMapping` set on the panel

#### Scenario: Unbind panel from type
- **WHEN** `PATCH /api/panels/:id` is called with `{ "typeId": null }`
- **THEN** the response is 200 with `typeId` and `fieldMapping` set to `null`
