## ADDED Requirements

### Requirement: create_panel exposes the v1.5 panel type set

The MCP `create_panel` tool SHALL accept the panel `type` set
`metric/chart/table/text/markdown/image/collection` and SHALL NOT offer `divider` — dropped for
agent/UI parity, mirroring the human app's HEL-249 removal of divider creation (the backend wire
contract still accepts `type: "divider"`; the MCP simply no longer offers it). The tool description
SHALL document each type's `config` shape and the `helio://uploads/image/<id>` markdown image
reference scheme, with no stale type list remaining.

#### Scenario: Agent creates a collection panel
- **WHEN** an agent calls `create_panel` with `type: "collection"` and `config: { baseType:
  "metric", layout: "grid" }`
- **THEN** the tool posts to `POST /api/panels` and returns the created panel id, and the panel
  persists as a collection with the given base type and layout

#### Scenario: Divider is not offered
- **WHEN** an agent inspects the `create_panel` type enum
- **THEN** `divider` is absent from the accepted values and the description lists only the seven
  creatable types

### Requirement: create_panel can set chart type and per-type chart/table config

The MCP `create_panel` tool SHALL accept an optional `appearance` passthrough so a chart panel's
`chartType` (`line`/`bar`/`pie`/`scatter`) can be set at creation, and its description SHALL document
the per-chart-type `config.chartOptions` shape (HEL-248) and the table
`config.density`/`config.columnOrder` shape (HEL-255). Because the backend `ChartAppearance` requires
its non-optional fields (`seriesColors`/`legend`/`tooltip`/`axisLabels`) to be present, the tool SHALL
send a COMPLETE `ChartAppearance` — merging the caller-supplied `chartType` into the default chart
appearance — never a bare `{ chartType }` object (which fails backend deserialization).

#### Scenario: Agent creates a bar chart at creation time
- **WHEN** an agent calls `create_panel` with `type: "chart"` requesting chart type `bar`
- **THEN** the tool sends a complete `ChartAppearance` with `chartType: "bar"`, the created panel
  renders as a bar chart, and `config.chartOptions.bar` options passed in `config` are persisted

#### Scenario: Invalid chart type is surfaced verbatim
- **WHEN** an agent passes an `appearance.chart.chartType` the backend rejects
- **THEN** the tool returns the backend's 400 message unchanged, not a generic failure

### Requirement: bind_panel supports text, markdown, and collection panels

The MCP `bind_panel` tool SHALL accept `panelType` values
`metric/chart/table/text/markdown/collection`, and its description SHALL document the backend-verified
`fieldMapping` keys per type: metric `value`/`label`/`unit`; chart `xAxis`/`yAxis`/`series`; text and
markdown `content`; collection the base-type slots (metric → `value`/`label`/`unit`). It SHALL note
that a collection's `baseType`/`layout` are set on `create_panel` and preserved by the merge-patch.

#### Scenario: Agent binds a markdown panel to a DataType field
- **WHEN** an agent calls `bind_panel` with `panelType: "markdown"`, a pipeline-output `dataTypeId`,
  and `fieldMapping: { content: "<column>" }`
- **THEN** the tool PATCHes the panel binding and the markdown panel renders the bound column's value

#### Scenario: Agent binds a collection panel
- **WHEN** an agent calls `bind_panel` with `panelType: "collection"`, a multi-row pipeline-output
  `dataTypeId`, and metric-slot `fieldMapping` (e.g. `{ value: "amount", label: "name" }`)
- **THEN** the collection renders one metric item per row, and the create-time `baseType`/`layout`
  are unchanged

#### Scenario: Binding a source-companion DataType is rejected verbatim
- **WHEN** an agent binds any panel to a source-companion DataType (not a pipeline output)
- **THEN** the tool surfaces the backend's 400 (V41 pipeline-only) message unchanged

### Requirement: upload_image MCP tool

The MCP server SHALL expose an `upload_image` tool that accepts image bytes (as base64 or text) and a
filename, posts them as a single `file` multipart part to `POST /api/uploads/image`, and returns the
uploaded image's `id`, its served `url` (`/api/uploads/image/<id>`), and the
`helio://uploads/image/<id>` markdown reference usable in a markdown panel's `config.content` (or an
image panel's `config.imageUrl`).

#### Scenario: Agent uploads an image and references it in markdown
- **WHEN** an agent calls `upload_image` with image content and a filename
- **THEN** the tool returns the `id`, served `url`, and `helio://uploads/image/<id>` ref, and that
  ref renders the image when placed in a bound/authored markdown panel

#### Scenario: Oversized image is rejected verbatim
- **WHEN** the uploaded image exceeds the backend's configured maximum size
- **THEN** the tool returns the backend's 413 error message unchanged, not a generic failure

### Requirement: create-panel-request schema agrees with the MCP type set

The `schemas/create-panel-request.schema.json` `type` enum SHALL include `collection` with a matching
config branch referencing `panel.schema.json#/$defs/CollectionConfig`, so the published create-panel
contract and the MCP tool agree on the creatable collection type (absorbing HEL-310).

#### Scenario: Schema validates a collection create request
- **WHEN** a `create_panel` request with `type: "collection"` and a valid `CollectionConfig` is
  validated against `create-panel-request.schema.json`
- **THEN** it validates successfully
