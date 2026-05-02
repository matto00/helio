## MODIFIED Requirements

### Requirement: Panel has a persisted type field
Every panel SHALL have a `type` field persisted in the database with one of the values:
`metric`, `chart`, `text`, `table`, `markdown`. The default value SHALL be `metric`.

#### Scenario: New panel created without type defaults to metric
- **WHEN** a panel is created without a `type` field in the request body
- **THEN** the created panel has `type: "metric"` in the response

#### Scenario: New panel created with explicit type
- **WHEN** a panel is created with `type: "chart"` in the request body
- **THEN** the created panel has `type: "chart"` in the response

#### Scenario: New panel created with markdown type
- **WHEN** a panel is created with `type: "markdown"` in the request body
- **THEN** the created panel has `type: "markdown"` in the response

#### Scenario: Panel response always includes type
- **WHEN** any panel is retrieved via `GET /api/dashboards/:id/panels`
- **THEN** each panel object in the response includes a `type` field with a valid type value

## ADDED Requirements

### Requirement: Panel response includes a content field
Every panel response SHALL include a `content` field. For markdown panels the value SHALL be the
stored Markdown source string (or null if no content has been set). For all other panel types the
value SHALL be null.

#### Scenario: Markdown panel returns content in response
- **WHEN** a markdown panel is retrieved
- **THEN** the response includes a `content` field with the stored Markdown string (or null)

#### Scenario: Non-markdown panel returns null content
- **WHEN** a panel with type other than markdown is retrieved
- **THEN** the response includes `content: null`

### Requirement: PATCH accepts a content field
The `PATCH /api/panels/:id` endpoint SHALL accept an optional `content` field. When provided for
a markdown panel, the backend SHALL update the stored content. For non-markdown panels the field
SHALL be ignored.

#### Scenario: PATCH with content on markdown panel updates content
- **WHEN** `PATCH /api/panels/:id` is called with `content: "# New"` on a markdown panel
- **THEN** the response includes `content: "# New"`

#### Scenario: PATCH without content leaves content unchanged
- **WHEN** `PATCH /api/panels/:id` is sent without a `content` field
- **THEN** the panel's existing content is preserved in the response

## MODIFIED Requirements

### Requirement: Invalid type values are rejected
The API SHALL reject panel create and update requests that supply an unrecognised `type` value
with a 400 Bad Request response. Valid type values are: `metric`, `chart`, `text`, `table`, `markdown`.

#### Scenario: Unknown type is rejected on create
- **WHEN** `POST /api/panels` is called with `type: "unknown"`
- **THEN** the response is 400 Bad Request

#### Scenario: Unknown type is rejected on update
- **WHEN** `PATCH /api/panels/:id` is called with `type: "unknown"`
- **THEN** the response is 400 Bad Request
