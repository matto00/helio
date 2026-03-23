## MODIFIED Requirements

### Requirement: Panel response includes DataType binding fields
Every panel response SHALL include `typeId` (string | null), `fieldMapping` (object | null), and `refreshInterval` (number | null) in addition to the existing type field.

#### Scenario: New panel has null binding fields
- **WHEN** a panel is created
- **THEN** the response includes `typeId: null`, `fieldMapping: null`, and `refreshInterval: null`

#### Scenario: Panel with binding returns binding fields
- **WHEN** a panel with a bound DataType is retrieved
- **THEN** the response includes the non-null `typeId`, `fieldMapping`, and `refreshInterval`

### Requirement: PATCH accepts DataType binding fields
The `PATCH /api/panels/:id` endpoint SHALL accept optional `typeId`, `fieldMapping`, and `refreshInterval` fields and update the panel's binding when provided.

#### Scenario: PATCH updates typeId and fieldMapping
- **WHEN** a PATCH request includes `typeId` and `fieldMapping`
- **THEN** the response includes the updated binding fields

#### Scenario: PATCH without binding fields leaves binding unchanged
- **WHEN** a PATCH request is sent without binding fields
- **THEN** the panel's existing typeId, fieldMapping, and refreshInterval are preserved
