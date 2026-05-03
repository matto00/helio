## MODIFIED Requirements

### Requirement: Panel has a persisted type field
Every panel SHALL have a `type` field persisted in the database with one of the values:
`metric`, `chart`, `text`, `table`, `markdown`, `image`, `divider`. The default value SHALL be `metric`.

#### Scenario: New panel created without type defaults to metric
- **WHEN** a panel is created without a `type` field in the request body
- **THEN** the created panel has `type: "metric"` in the response

#### Scenario: New panel created with explicit type
- **WHEN** a panel is created with `type: "chart"` in the request body
- **THEN** the created panel has `type: "chart"` in the response

#### Scenario: New panel created with markdown type
- **WHEN** a panel is created with `type: "markdown"` in the request body
- **THEN** the created panel has `type: "markdown"` in the response

#### Scenario: New panel created with image type
- **WHEN** a panel is created with `type: "image"` in the request body
- **THEN** the created panel has `type: "image"` in the response

#### Scenario: New panel created with divider type
- **WHEN** a panel is created with `type: "divider"` in the request body
- **THEN** the created panel has `type: "divider"` in the response

#### Scenario: Panel response always includes type
- **WHEN** any panel is retrieved via `GET /api/dashboards/:id/panels`
- **THEN** each panel object in the response includes a `type` field with a valid type value

### Requirement: Invalid type values are rejected
The API SHALL reject panel create and update requests that supply an unrecognised `type` value
with a 400 Bad Request response. Valid type values are: `metric`, `chart`, `text`, `table`,
`markdown`, `image`, `divider`.

#### Scenario: Unknown type is rejected on create
- **WHEN** `POST /api/panels` is called with `type: "unknown"`
- **THEN** the response is 400 Bad Request

#### Scenario: Unknown type is rejected on update
- **WHEN** `PATCH /api/panels/:id` is called with `type: "unknown"`
- **THEN** the response is 400 Bad Request
