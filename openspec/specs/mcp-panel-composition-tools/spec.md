# mcp-panel-composition-tools Specification

## Purpose
Give the MCP agent surface v1.5 panel parity — letting an agent create every current panel type
(including collection), bind text/markdown/collection panels with backend-verified field mappings,
set chart type and per-type chart/table config, and upload images — so agents can build dashboards
with the full panel capability set the backend already supports.

## Requirements

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

The `schemas/panels/create-panel-request.schema.json` `type` enum SHALL include `collection` with a matching
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
data panel's server-resolved `outputId` binding SHALL remain authoritative so the V41 pipeline-only
binding guarantee cannot be bypassed via `config`.

#### Scenario: Collection base type and layout via proposal config
- **WHEN** an agent applies a proposal whose collection panel supplies
  `config: { baseType: "metric", layout: "grid" }` and a valid `outputId`
- **THEN** the applied panel persists as a collection with that base type and layout, bound to the
  DataType

#### Scenario: Chart chartOptions via proposal config
- **WHEN** an agent applies a proposal whose chart panel supplies
  `config: { chartOptions: { smooth: true } }` alongside its binding
- **THEN** the applied chart panel persists with those chart options

#### Scenario: config cannot bypass pipeline-only binding
- **WHEN** an agent applies a proposal whose data panel `config` attempts to override `outputId`
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
at parity with `metric`/`collection`. A `timeline` proposal panel with a `outputId` and a
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

- **WHEN** an agent applies a proposal whose `timeline` panel supplies a valid `outputId` and a
  `fieldMapping` of `{ time, event }` and no `config`
- **THEN** the applied panel persists as a bound timeline panel whose `config` carries that
  `outputId` and `fieldMapping`, with `sort` resolving to its default `"asc"`

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

### Requirement: auto_layout_dashboard packs panel sizes into a non-overlapping layout

The MCP `auto_layout_dashboard` tool SHALL accept a dashboard id and a list of `{panelId, w, h}` sizes,
call `POST /api/dashboards/:id/auto-layout`, and return the packed, persisted layout — replacing the
need for an agent (e.g. `helio-news`'s `_pack`/`_fill_shelf`/`_clamp`) to compute panel positions itself.

#### Scenario: Agent packs a set of newly created panels
- **WHEN** an agent calls `auto_layout_dashboard` with a dashboard id and an ordered list of panel sizes
- **THEN** the tool posts to the auto-layout endpoint and returns the dashboard's updated, non-overlapping
  layout in the same order the sizes were supplied

#### Scenario: Backend validation errors surface verbatim
- **WHEN** the request includes a `panelId` that does not belong to the target dashboard
- **THEN** the tool surfaces the backend's 400 message unchanged, not a generic failure

### Requirement: Proposal panels accept an optional metricId bound via the existing HEL-500 config path

Proposal panels SHALL accept an optional `metricId` (string) on the `propose_dashboard`/
`apply_proposal` `panelSchema` (`helio-mcp/src/tools/proposal.ts`), the helio-mcp `ProposalPanel` type
(`types.ts`), and the backend `ProposalPanel` protocol (`DashboardProposalProtocol.scala`), additive to
the existing flat fields. `outputId` SHALL remain required for `metric`/`chart`/`table` proposal panels
exactly as today — `metricId` does not relax that requirement. When present and valid,
`ProposalPanelSupport.buildCreateRequest`/`buildDataConfig` SHALL include `metricId` in the created
panel's config, reusing the same `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` `metricId`
slot HEL-500 already validates and materializes at read time. `schemas/dashboards/dashboard-proposal.schema.json`
SHALL document the field. The `propose_dashboard` tool's `description` string SHALL document `metricId`
per-type (mirroring the existing `label`/`unit` bullet for `metric`) — the zod schema itself carries no
per-field `.describe()`, so this is the only place a calling agent can discover the capability. A
proposal supplying only the pre-existing flat fields (no `metricId`) SHALL behave byte-for-byte as
before this change.

#### Scenario: Proposal panel with a valid metricId is created bound to that metric

- **WHEN** an agent applies a proposal whose `metric` panel supplies a valid `outputId`,
  `fieldMapping`, and a `metricId` resolving to a metric the caller owns
- **THEN** the created panel's `config.metricId` is set to that id

#### Scenario: Proposal without metricId is unchanged

- **WHEN** an agent applies a proposal whose panels use only the pre-existing flat fields and no
  `metricId`
- **THEN** the created dashboard and panels are identical to the pre-change behavior

#### Scenario: Tool description documents metricId

- **WHEN** an agent inspects the `propose_dashboard` tool's description
- **THEN** it documents that `metric`/`chart`/`table` panels may supply `metricId` to bind to a
  defined metric, alongside the existing per-type field guidance

### Requirement: preValidateBindings rejects an invalid or unsupported metricId before any creation

`ProposalPanelSupport.preValidateBindings` SHALL, for each panel carrying a `metricId`, reject (400,
before any dashboard or panel is created) when the id does not resolve to a metric owned by the
caller, when it resolves to a metric with `deprecated: true`, or when the panel's `type` is outside
`metric`/`chart`/`table` (the exact set HEL-500 added `metricId` support to — `collection`/`timeline`
are not supported). A `metricId` resolving to a caller-owned, non-deprecated metric on a supported
panel type SHALL pass validation. This check SHALL be shared by both `DashboardProposalService.apply`
and `DashboardContentsService.replaceContents`, since both call `preValidateBindings`.

#### Scenario: Nonexistent or foreign metricId rejects the whole apply

- **WHEN** an agent applies a proposal whose panel supplies a `metricId` that does not resolve to any
  metric owned by the caller
- **THEN** the response is 400 and no dashboard or panel is created

#### Scenario: Deprecated metricId rejects the whole apply

- **WHEN** an agent applies a proposal whose panel supplies a `metricId` resolving to a metric with
  `deprecated: true`
- **THEN** the response is 400 and no dashboard or panel is created

#### Scenario: metricId on an unsupported panel type rejects the whole apply

- **WHEN** an agent applies a proposal whose `collection` or `timeline` panel supplies a `metricId`
- **THEN** the response is 400 and no dashboard or panel is created

#### Scenario: DashboardContentsService inherits the same metricId validation

- **WHEN** a caller replaces a dashboard's contents (`PUT /api/dashboards/:id/contents`) with a panel
  set including a panel whose `metricId` does not resolve to a metric they own
- **THEN** the response is 400 and the dashboard's existing contents are unchanged

### Requirement: propose_dashboard warns on a problematic metricId

The `propose_dashboard` tool's read-only validation SHALL fetch the caller's metric catalog
(`api.listMetrics()`) and, for each panel carrying a `metricId`, add a warning when the id is
missing/not found among the caller's owned metrics, resolves to a metric with `deprecated: true`, or
is set on a panel type outside `metric`/`chart`/`table`. `applyReady` SHALL be `false` whenever any
such warning is present, so an agent never sees `applyReady: true` for a proposal that would then be
rejected by `preValidateBindings` at apply time.

#### Scenario: Missing metricId produces a warning

- **WHEN** an agent calls `propose_dashboard` with a panel whose `metricId` does not resolve to any
  metric the caller owns
- **THEN** the response includes a warning naming that panel and `applyReady: false`

#### Scenario: Deprecated metricId produces a warning

- **WHEN** an agent calls `propose_dashboard` with a panel whose `metricId` resolves to a metric with
  `deprecated: true`
- **THEN** the response includes a warning naming that panel and `applyReady: false`

#### Scenario: Valid metricId on a supported panel type produces no warning

- **WHEN** an agent calls `propose_dashboard` with a `metric`/`chart`/`table` panel whose `metricId`
  resolves to a caller-owned, non-deprecated metric
- **THEN** the response includes no metricId-related warning for that panel

### Requirement: update_panel MCP tool
The MCP server SHALL expose `update_panel` accepting only placement fields (`title`, `w`, `h`,
position) — DataType/binding fields SHALL NOT be accepted, since a panel's Output binding is fixed
at placement time and is not mutable via `update_panel`.

#### Scenario: Agent resizes a placed panel
- **WHEN** an agent calls `update_panel` with a valid `panelId` and new `w`/`h`
- **THEN** the tool updates the placement and returns the updated panel

#### Scenario: Attempting to rebind a panel's Output is rejected
- **WHEN** an agent calls `update_panel` with a field attempting to change the panel's bound
  Output
- **THEN** the tool rejects the call before issuing any HTTP request, since `update_panel`'s
  schema does not accept a binding field
