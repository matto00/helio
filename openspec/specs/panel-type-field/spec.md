### Requirement: Panel has a persisted type field
Every panel SHALL have a `type` field persisted in the database with one of the values: `metric`, `chart`, `text`, `table`. The default value SHALL be `metric`.

#### Scenario: New panel created without type defaults to metric
- **WHEN** a panel is created without a `type` field in the request body
- **THEN** the created panel has `type: "metric"` in the response

#### Scenario: New panel created with explicit type
- **WHEN** a panel is created with `type: "chart"` in the request body
- **THEN** the created panel has `type: "chart"` in the response

#### Scenario: Panel response always includes type
- **WHEN** any panel is retrieved via `GET /api/dashboards/:id/panels`
- **THEN** each panel object in the response includes a `type` field with a valid type value

### Requirement: Panel type is updatable via PATCH
The `PATCH /api/panels/:id` endpoint SHALL accept an optional `type` field and update the panel's type when provided.

#### Scenario: PATCH updates panel type
- **WHEN** a PATCH request is sent with `type: "table"`
- **THEN** the response includes the panel with `type: "table"`

#### Scenario: PATCH without type leaves type unchanged
- **WHEN** a PATCH request is sent without a `type` field
- **THEN** the panel's existing type is preserved in the response

### Requirement: Invalid type values are rejected
The API SHALL reject panel create and update requests that supply an unrecognised `type` value with a 400 Bad Request response.

#### Scenario: Unknown type is rejected on create
- **WHEN** `POST /api/panels` is called with `type: "unknown"`
- **THEN** the response is 400 Bad Request

#### Scenario: Unknown type is rejected on update
- **WHEN** `PATCH /api/panels/:id` is called with `type: "unknown"`
- **THEN** the response is 400 Bad Request

### Requirement: Existing panels retain metric type after migration
All panels that existed before the `type` column was added SHALL have `type: "metric"` after the Flyway migration runs.

#### Scenario: Pre-existing panel has default type
- **WHEN** the database migration runs on a database with existing panel rows
- **THEN** all existing panels have `type = 'metric'`

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
