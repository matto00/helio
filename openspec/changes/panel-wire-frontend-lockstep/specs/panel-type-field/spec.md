## MODIFIED Requirements

### Requirement: Panel response includes DataType binding fields
Every panel response for a type that supports DataType binding (`metric`, `chart`, `table`) SHALL
carry `dataTypeId` (string, possibly empty) and `fieldMapping` (object, possibly empty) inside the
typed `config` payload. Non-binding subtypes (`text`, `markdown`, `image`, `divider`) SHALL NOT carry
these fields. The legacy flat `typeId`, `fieldMapping`, and `refreshInterval` fields at the response
root MUST NOT appear.

#### Scenario: New binding-capable panel has empty binding fields in config
- **WHEN** a `metric`, `chart`, or `table` panel is created with no binding
- **THEN** the response includes `config.dataTypeId: ""` and `config.fieldMapping: {}` (or equivalent empty values)

#### Scenario: Binding-capable panel with binding returns binding fields in config
- **WHEN** a bound `metric`, `chart`, or `table` panel is retrieved
- **THEN** the response includes the non-empty `config.dataTypeId` and `config.fieldMapping`

#### Scenario: Non-binding panel response omits binding fields
- **WHEN** a `text`, `markdown`, `image`, or `divider` panel is retrieved
- **THEN** the response does not include `dataTypeId` or `fieldMapping` (at the root or in `config`)

### Requirement: PATCH accepts DataType binding fields
The `PATCH /api/panels/:id` endpoint SHALL accept an optional typed `config` payload whose shape
matches the panel's `type`. For binding-capable subtypes (`metric`, `chart`, `table`), `config.dataTypeId`
and `config.fieldMapping` SHALL be updatable, with absent-vs-null distinction preserved per field
(absent leaves the value unchanged; explicit null clears it).

#### Scenario: PATCH updates dataTypeId and fieldMapping via typed config
- **WHEN** a PATCH request includes `type: "metric"` and `config: { dataTypeId, fieldMapping }`
- **THEN** the response includes the updated binding fields inside `config`

#### Scenario: PATCH without config leaves binding unchanged
- **WHEN** a PATCH request is sent without a `config` field
- **THEN** the panel's existing binding is preserved in the response

#### Scenario: PATCH with explicit null clears a config field
- **WHEN** a PATCH request includes `type: "metric"` and `config: { dataTypeId: null }`
- **THEN** the response shows `config.dataTypeId` as empty

### Requirement: Panel response includes a content field
For `text` and `markdown` panels, the response SHALL include `config.content` (string, possibly
empty). For other subtypes, the response SHALL NOT include `content` (at the root or in `config`).
The legacy flat `content` field at the response root MUST NOT appear.

#### Scenario: Markdown panel returns content inside config
- **WHEN** a markdown panel is retrieved
- **THEN** the response includes `type: "markdown"` and `config.content` with the stored Markdown string (possibly empty)

#### Scenario: Text panel returns content inside config
- **WHEN** a text panel is retrieved
- **THEN** the response includes `type: "text"` and `config.content` with the stored text string (possibly empty)

#### Scenario: Non-text/markdown panel response omits content
- **WHEN** a panel with type `metric`, `chart`, `table`, `image`, or `divider` is retrieved
- **THEN** the response does not include a `content` field (at the root or in `config`)

### Requirement: PATCH accepts a content field
The `PATCH /api/panels/:id` endpoint SHALL accept a typed `config.content` field for `text` and
`markdown` panels. For other subtypes, sending a `config` with a `content` field SHALL be ignored
(the `config` shape for those subtypes does not include `content`).

#### Scenario: PATCH with config.content on markdown panel updates content
- **WHEN** `PATCH /api/panels/:id` is called with `type: "markdown"` and `config: { content: "# New" }` on a markdown panel
- **THEN** the response includes `config.content: "# New"`

#### Scenario: PATCH without config.content leaves content unchanged
- **WHEN** `PATCH /api/panels/:id` is sent without `config.content`
- **THEN** the panel's existing content is preserved in the response

### Requirement: Panel response includes imageUrl and imageFit fields
For `image` panels, the response SHALL include `config.imageUrl` (string, possibly empty) and
`config.imageFit` (string). For other subtypes, the response SHALL NOT include `imageUrl` or
`imageFit` (at the root or in `config`). The legacy flat `imageUrl` and `imageFit` fields at the
response root MUST NOT appear.

#### Scenario: Image panel response includes imageUrl and imageFit in config
- **WHEN** an image panel with a stored URL and fit is retrieved
- **THEN** the response includes `type: "image"` and `config: { imageUrl, imageFit }`

#### Scenario: Non-image panel response omits image fields
- **WHEN** a panel with type other than `image` is retrieved
- **THEN** the response does not include `imageUrl` or `imageFit` (at the root or in `config`)

## ADDED Requirements

### Requirement: Create requests use a discriminated config wire shape
`POST /api/panels` SHALL accept a payload of shape `{ dashboardId, title?, type, config }`, where
`config` is a typed object whose shape is determined by `type`. Per-subtype flat fields
(`content`, `dataTypeId`, etc.) at the request root MUST NOT be accepted; they SHALL be moved into
`config`. The `type` field is required.

#### Scenario: Create metric panel with typed config
- **WHEN** `POST /api/panels` is called with `{ dashboardId, type: "metric", config: { dataTypeId: "dt1", fieldMapping: {} } }`
- **THEN** the created panel has `type: "metric"` and `config.dataTypeId: "dt1"`

#### Scenario: Create image panel with typed config
- **WHEN** `POST /api/panels` is called with `{ dashboardId, type: "image", config: { imageUrl: "https://x", imageFit: "cover" } }`
- **THEN** the created panel has `type: "image"` and the corresponding `config`

#### Scenario: Create with config shape mismatched to type is rejected
- **WHEN** `POST /api/panels` is called with `{ dashboardId, type: "image", config: { content: "x" } }`
- **THEN** the response is 400 Bad Request

#### Scenario: Create with empty config falls back to defaults
- **WHEN** `POST /api/panels` is called with `{ dashboardId, type: "metric", config: {} }`
- **THEN** the response is 201 Created and the panel has default values for the metric config

### Requirement: Update requests use a discriminated config wire shape with absent-vs-null semantics
`PATCH /api/panels/:id` SHALL accept a payload of shape `{ title?, appearance?, type?, config? }`,
where `config` (when present) is a typed object whose shape matches the panel's current `type`. If
the request `type` differs from the stored panel's `type`, the request SHALL be rejected with 400
Bad Request (cross-type PATCH lock). Within `config`, fields absent from the payload SHALL leave the
stored value unchanged; fields with explicit JSON `null` SHALL clear the stored value.

#### Scenario: PATCH with matching type updates typed config
- **WHEN** `PATCH /api/panels/:id` is called with `{ type: "metric", config: { dataTypeId: "dt2" } }` on a metric panel
- **THEN** the response includes the updated binding inside `config`

#### Scenario: Cross-type PATCH is rejected
- **WHEN** `PATCH /api/panels/:id` is called with `type: "chart"` on a metric panel
- **THEN** the response is 400 Bad Request

#### Scenario: PATCH with absent config field leaves it unchanged
- **WHEN** `PATCH /api/panels/:id` is called with `{ type: "metric", config: {} }`
- **THEN** the stored `dataTypeId` and `fieldMapping` are unchanged

#### Scenario: PATCH with null config field clears it
- **WHEN** `PATCH /api/panels/:id` is called with `{ type: "metric", config: { dataTypeId: null } }`
- **THEN** the stored `dataTypeId` becomes empty

### Requirement: Per-subtype request decoders accept partial configs
Every panel subtype's request-side decoder SHALL accept an empty `config` payload (`decode("{}")`
succeeds with all-default values). This is the codec read-path tolerance rule.

#### Scenario: Empty metric config decodes to defaults
- **WHEN** a metric `CreateConfig` request decoder is invoked with `{}`
- **THEN** decoding succeeds with all fields set to defaults (empty `dataTypeId`, empty `fieldMapping`)

#### Scenario: Empty divider config decodes to defaults
- **WHEN** a divider `CreateConfig` request decoder is invoked with `{}`
- **THEN** decoding succeeds with default orientation, weight, and color
