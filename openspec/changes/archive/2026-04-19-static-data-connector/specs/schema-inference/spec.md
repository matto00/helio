## ADDED Requirements

### Requirement: Static connector uses declared column types without inference
For static data sources, the system SHALL construct `DataField` entries directly from the user-declared `columns` array (`{ name, type }`) rather than running `SchemaInferenceEngine`. The declared `type` value SHALL be mapped to the corresponding `DataFieldType` string. An unrecognised type string SHALL default to `"string"`.

#### Scenario: Declared integer type is preserved
- **WHEN** a static source is created with a column declared as `{ "name": "count", "type": "integer" }`
- **THEN** the registered `DataType` contains a field `count` with `dataType = "integer"`

#### Scenario: Declared boolean type is preserved
- **WHEN** a static source is created with a column declared as `{ "name": "active", "type": "boolean" }`
- **THEN** the registered `DataType` contains a field `active` with `dataType = "boolean"`

#### Scenario: Unrecognised type defaults to string
- **WHEN** a static source column is declared with an unrecognised type string
- **THEN** the registered field has `dataType = "string"`
