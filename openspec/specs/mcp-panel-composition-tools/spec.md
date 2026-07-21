# mcp-panel-composition-tools Specification

## Purpose
Give the MCP agent surface v1.5 panel parity — letting an agent create every current panel type
(including collection), bind text/markdown/collection panels with backend-verified field mappings,
set chart type and per-type chart/table config, and upload images — so agents can build dashboards
with the full panel capability set the backend already supports.
## Requirements
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

### Requirement: propose_dashboard exposes the v1.5 panel type set

The MCP `propose_dashboard` and `apply_proposal` tools SHALL accept the panel `type` set
`metric/chart/table/text/markdown/image/collection` and SHALL NOT offer `divider`, matching
`create_panel`'s type set for agent/UI parity (mirroring HEL-249 / HEL-315). No stale type list
SHALL remain in the proposal flow's tool schemas or descriptions. The `dashboard-proposal.schema.json`
`ProposalPanel.type` enum SHALL likewise drop `divider`.

#### Scenario: Divider is not offered in the proposal flow
- **WHEN** an agent inspects the `propose_dashboard`/`apply_proposal` panel `type` enum
- **THEN** `divider` is absent from the accepted values and only the seven proposable types remain

#### Scenario: Collection is proposable
- **WHEN** an agent calls `propose_dashboard` with a panel of `type: "collection"`
- **THEN** the tool accepts it and the assembled proposal carries the collection panel

### Requirement: Proposal panels accept a generic config passthrough

Each proposal panel SHALL accept an optional generic `config` object that is carried through
`apply_proposal` to `POST /api/dashboards/apply-proposal` and merged into the config the backend
derives from the flat fields, then decoded by the SAME panel-create path (`PanelConfigCodec`). This
SHALL make every v1.5 config surface expressible via a proposal — collection `baseType`/`layout`,
chart `chartOptions` (per chart type), table `density`/`columnOrder`, and text/markdown content
binding. On key conflict the explicit `config` SHALL win over a derived flat field, EXCEPT that a
data panel's server-resolved `dataTypeId` binding SHALL remain authoritative so the V41 pipeline-only
binding guarantee cannot be bypassed via `config`.

#### Scenario: Collection base type and layout via proposal config
- **WHEN** an agent applies a proposal whose collection panel supplies
  `config: { baseType: "metric", layout: "grid" }` and a valid `dataTypeId`
- **THEN** the applied panel persists as a collection with that base type and layout, bound to the
  DataType

#### Scenario: Chart chartOptions via proposal config
- **WHEN** an agent applies a proposal whose chart panel supplies
  `config: { chartOptions: { smooth: true } }` alongside its binding
- **THEN** the applied chart panel persists with those chart options

#### Scenario: config cannot bypass pipeline-only binding
- **WHEN** an agent applies a proposal whose data panel `config` attempts to override `dataTypeId`
  with a source-companion (non-pipeline-output) DataType id
- **THEN** the flat-field binding remains authoritative and the V41 pipeline-only rule is still
  enforced

### Requirement: Proposal config passthrough is backward compatible

The `config` field SHALL be optional and additive: a proposal carrying only the existing flat fields
(and no `config`) SHALL produce byte-for-byte the same created panels as before this change. The
shared in-app Proposal Review UI, which posts to the same endpoint, SHALL continue to round-trip
proposals unchanged.

#### Scenario: Flat-field-only proposal is unchanged
- **WHEN** an agent applies a proposal whose panels use only the flat fields (`fieldMapping`,
  `aggregation`, `content`, `chartType`, etc.) and no `config`
- **THEN** the created dashboard and panels are identical to the pre-change behavior

#### Scenario: Proposal Review UI still round-trips
- **WHEN** a proposal is applied through the in-app Proposal Review UI
- **THEN** the dashboard and its panels are created correctly with no regression

### Requirement: Panel composition tools accept image caption and chart annotation

The MCP panel create/update tool surface SHALL accept an optional `caption` on image-panel `config` and
an optional `annotation` on chart-panel `config`, passing each straight through to the panel API so
agent-built dashboards can attach static caption/annotation text. The tool descriptions SHALL document
both fields on the respective panel `config` shapes. Omitting either field SHALL preserve today's
behavior (no caption/annotation).

#### Scenario: Agent creates an image panel with a caption
- **WHEN** an agent calls the create tool with `type: "image"` and `config: { imageUrl: "...",
  caption: "Hero photo — Reuters" }`
- **THEN** the created image panel persists with that `caption` and the dashboard renders its caption
  strip

#### Scenario: Agent sets a chart annotation
- **WHEN** an agent creates or updates a chart panel with `config.annotation: "Source: BLS"`
- **THEN** the panel persists with that `annotation` and renders it as a subtitle/footnote

#### Scenario: Omitting caption/annotation preserves current behavior
- **WHEN** an agent creates an image or chart panel without a `caption`/`annotation`
- **THEN** the panel is created with no caption/annotation, exactly as before this change

### Requirement: Proposal panels derive a timeline binding from flat fields

The proposal flow SHALL let a `timeline` panel express its full binding through flat fields alone,
at parity with `metric`/`collection`. A `timeline` proposal panel with a `dataTypeId` and a
`fieldMapping` binding the `time` and `event` slots SHALL apply to a bound, rendering Timeline panel
without requiring the generic `config` passthrough. The proposal panel contract SHALL additionally
accept an optional flat `sort` field (`"asc"` | `"desc"`); when present on a `timeline` panel,
`DashboardProposalService` SHALL derive it into the panel's `config.timelineOptions.sort` so it is
decoded by the same panel-create path (`PanelConfigCodec`) as any other timeline config. An invalid
flat `sort` value SHALL be rejected up front (before any dashboard or panel is created), mirroring the
existing `chartType` / `orientation` pre-create checks. The helio-mcp `propose_dashboard` tool schema
and description, the `dashboard-proposal.schema.json` `ProposalPanel` definition, and the helio-mcp
`ProposalPanel` type SHALL advertise the flat `sort` field and describe timeline binding accurately.

#### Scenario: Timeline binding via flat fields only

- **WHEN** an agent applies a proposal whose `timeline` panel supplies a valid `dataTypeId` and a
  `fieldMapping` of `{ time, event }` and no `config`
- **THEN** the applied panel persists as a bound timeline panel whose `config` carries that
  `dataTypeId` and `fieldMapping`, with `sort` resolving to its default `"asc"`

#### Scenario: Timeline sort via the flat field

- **WHEN** an agent applies a proposal whose `timeline` panel supplies `sort: "desc"` alongside its
  binding and no `config`
- **THEN** the applied panel persists with `config.timelineOptions.sort` equal to `"desc"`

#### Scenario: Invalid flat sort rejects the whole proposal

- **WHEN** an agent applies a proposal whose `timeline` panel supplies a `sort` value outside
  `{ "asc", "desc" }`
- **THEN** the request is rejected with a 400 and no dashboard or panel is created

#### Scenario: Explicit config still overrides the flat sort

- **WHEN** an agent applies a proposal whose `timeline` panel supplies `sort: "asc"` and also
  `config: { timelineOptions: { sort: "desc" } }`
- **THEN** the applied panel persists with `config.timelineOptions.sort` equal to `"desc"` (explicit
  `config` wins over the flat-derived value)

#### Scenario: Proposal tool advertises the flat sort field

- **WHEN** an agent inspects the `propose_dashboard` tool schema/description and
  `dashboard-proposal.schema.json`
- **THEN** the flat `sort` field (`"asc"` | `"desc"`) is present and the timeline binding guidance
  describes it as a flat field rather than requiring `config`

