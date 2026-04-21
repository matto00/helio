## MODIFIED Requirements

### Requirement: Panel appearance chartType is validated
The panel schema MUST validate the optional `chartType` field within the appearance object.

#### Scenario: Panel schema validates chartType values
- **WHEN** panel payloads are validated against the schema
- **THEN** the appearance object accepts an optional `chartType` field
- **AND** `chartType` MUST be one of: line, bar, pie, scatter when present

#### Scenario: Panel schema rejects unknown chartType values
- **WHEN** a panel appearance payload contains a `chartType` value not in the allowed set
- **THEN** schema validation fails with an error indicating the invalid value

#### Scenario: Panel schema accepts payload without chartType
- **WHEN** a panel appearance payload omits the `chartType` field
- **THEN** schema validation succeeds and the panel is stored without a chartType
