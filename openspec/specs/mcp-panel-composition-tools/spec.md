# mcp-panel-composition-tools Specification

## Purpose
Give the MCP agent surface v1.5 panel parity — letting an agent create every current panel type, author literal
text/markdown panel content, set chart type and per-type chart/table config, and upload images — so agents can
build dashboards with the full panel capability set the backend already supports.

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
  ref renders the image when placed in a markdown panel's literal `config.content`

#### Scenario: Oversized image is rejected verbatim
- **WHEN** the uploaded image exceeds the backend's configured maximum size
- **THEN** the tool returns the backend's 413 error message unchanged, not a generic failure

### Requirement: auto_layout_dashboard packs panel sizes into a non-overlapping layout

The MCP `auto_layout_dashboard` tool SHALL accept a dashboard id, a list of `{panelId, w, h}` sizes, an optional `breakpoint` and an optional `expectedLayoutVersion`, call `POST /api/dashboards/:id/auto-layout`, and return the packed, persisted layout — replacing the need for an agent (e.g. `helio-news`'s `_pack`/`_fill_shelf`/`_clamp`) to compute panel positions itself. Without `breakpoint` every breakpoint is packed at its own column count; with it only that breakpoint changes. When `expectedLayoutVersion` is given it SHALL be sent in the request body; when omitted the request SHALL carry no precondition.

#### Scenario: Agent packs a set of newly created panels
- **WHEN** an agent calls `auto_layout_dashboard` with a dashboard id and an ordered list of panel sizes
- **THEN** the tool posts to the auto-layout endpoint and returns the dashboard's updated, non-overlapping
  layout in the same order the sizes were supplied

#### Scenario: Backend validation errors surface verbatim
- **WHEN** the request includes a `panelId` that does not belong to the target dashboard
- **THEN** the tool surfaces the backend's 400 message unchanged, not a generic failure

#### Scenario: Single-breakpoint pack
- **WHEN** an agent passes `breakpoint: "xs"`
- **THEN** the request carries `breakpoint` and the other breakpoints are unchanged

#### Scenario: Precondition forwarded
- **WHEN** an agent passes `expectedLayoutVersion` N
- **THEN** the auto-layout request body carries `expectedLayoutVersion` N

### Requirement: update_dashboard_layout sets one breakpoint without touching the others

The MCP `update_dashboard_layout` tool SHALL accept `items` with an optional `breakpoint` (`lg|md|sm|xs`, default `lg`) in that breakpoint's own column units, and alternatively a `layouts` object keyed by breakpoint. It SHALL PATCH only the breakpoints named, leaving every other breakpoint as stored, and SHALL NOT copy one placement to all four breakpoints. The listed items become that breakpoint's complete layout. Server `400` layout rejections (breakpoint and panel ids) SHALL be surfaced verbatim. The tool SHALL require a non-negative integer `expectedLayoutVersion`, the `layoutVersion` of the dashboard the agent last read, and SHALL send it in the same PATCH body as `layout`.

#### Scenario: Agent repairs xs without overwriting lg
- **WHEN** an agent calls `update_dashboard_layout` with `breakpoint: "xs"` and valid 2-column items
- **THEN** only `xs` is sent in the PATCH and `lg` is unchanged

#### Scenario: Overlapping xs is rejected verbatim
- **WHEN** an agent supplies overlapping `xs` items
- **THEN** the tool returns the backend's 400 message naming `xs` and the panel ids

#### Scenario: Precondition sent with the layout
- **WHEN** an agent calls `update_dashboard_layout` with `expectedLayoutVersion` N
- **THEN** the PATCH body carries `layout` and `expectedLayoutVersion` N

#### Scenario: Missing precondition is refused before any request
- **WHEN** an agent calls `update_dashboard_layout` without `expectedLayoutVersion`
- **THEN** the call is rejected by input validation and no request is sent

### Requirement: MCP placement and appearance tools state where a chart's type is resolved
The helio-mcp `place_outputs` and `update_panel_appearance` tool descriptions SHALL state the chart-type precedence
the dashboard renders with: the panel's own `appearance.chart.chartType` when set, else the bound Output's
`config.chartType`, else `line`. `place_outputs` SHALL say that a placement stores no chart type (so the Output's type
renders) and name `update_output` (Output default) and `update_panel_appearance` (per-panel override) as the two ways to
change it. `update_panel_appearance` SHALL say that clearing `chartType` with `null` renders the Output's type (else
line), not a fixed line default.

#### Scenario: place_outputs description names the precedence
- **WHEN** an MCP client lists tools and reads `place_outputs`'s description
- **THEN** it states that the rendered chart type is the panel appearance `chartType` if set, else the Output's
  `config.chartType`, else line
- **AND** it no longer claims chartType exists only on the Output

#### Scenario: update_panel_appearance description describes clearing chartType accurately
- **WHEN** an MCP client reads `update_panel_appearance`'s description
- **THEN** it states that `{chart: {chartType: null}}` makes the panel render its Output's `config.chartType` (else
  line)

### Requirement: Inert panel-level proposal fields are marked deprecated

The proposal panel fields `fieldMapping`, `aggregation`, `label` and `unit` have no effect on an applied panel (that
configuration lives on the Output). Every agent-facing description of the proposal panel shape — the dashboard
proposal JSON schema, the in-app assistant's proposal tool schema, and the MCP proposal tools' panel schema — SHALL
mark each of these four fields as deprecated and state that it is ignored and that the setting belongs on the
Output's `config`. The fields SHALL remain accepted: a proposal carrying them SHALL NOT be rejected for it, and SHALL
produce the same panels as the same proposal without them.

#### Scenario: Each agent-facing surface marks the four fields deprecated
- **WHEN** the proposal panel shape is read from the dashboard proposal JSON schema, the assistant proposal tool
  schema and the MCP proposal panel schema
- **THEN** on each surface `fieldMapping`, `aggregation`, `label` and `unit` are marked deprecated with a description
  saying they are ignored and belong on the Output config

#### Scenario: A proposal carrying the deprecated fields is still accepted and they stay inert
- **WHEN** a proposal whose output panel carries `fieldMapping`, `aggregation`, `label` and `unit` is applied
- **THEN** it is accepted and the created panel's config equals that of the same proposal without those fields

### Requirement: MCP dashboards expose the layout version
helio-mcp's dashboard type SHALL include the server's `layoutVersion`, and every MCP tool that returns a dashboard
record (including `list_dashboards`, `get_dashboard`, `update_dashboard_layout` and `auto_layout_dashboard`) SHALL pass
it through unchanged, so an agent can echo the version of the dashboard it last read.

#### Scenario: get_dashboard returns the layout version
- **WHEN** an agent calls `get_dashboard` on a dashboard whose stored `layoutVersion` is N
- **THEN** the result carries `layoutVersion` N

### Requirement: MCP layout tools surface a layout conflict without retrying
When `PATCH /api/dashboards/:id` or `POST /api/dashboards/:id/auto-layout` returns 409 with a `dashboard` in its body,
the calling MCP tool SHALL return an error result that names the conflict and carries that current dashboard, including
its `layoutVersion`, and SHALL tell the agent to recompute against it and call again with that version. The tool SHALL
NOT re-send the write, with or without a precondition. `place_outputs` SHALL surface a conflict from its internal pack
the same way and SHALL name the panels it created but did not position.

#### Scenario: Stale update_dashboard_layout
- **WHEN** an agent read layout version N, another writer then changes the layout, and the agent calls
  `update_dashboard_layout` with `expectedLayoutVersion` N
- **THEN** the tool returns an error result carrying the current dashboard with its newer `layoutVersion`, exactly one
  PATCH was sent, and the other writer's layout is what is stored

#### Scenario: place_outputs pack conflict
- **WHEN** `place_outputs` creates panels and its follow-up auto-layout returns 409
- **THEN** the error result names the created panel ids, says they were not positioned, and carries the current
  dashboard

### Requirement: propose_dashboard exposes the current agent-facing panel type set

The MCP `propose_dashboard` and `apply_proposal` tools SHALL accept the panel `type` set
`text/markdown/image/output/form` and SHALL NOT offer `divider`, which is excluded from the agent-facing proposal set
for a stated product-scope reason (purely presentational layout chrome with no content, binding or data an agent can
author) recorded in the repository's agent-surface exclusion table. The panel kinds
`metric`, `chart`, `table`, `collection` and `timeline` no longer exist and SHALL NOT be offered. No stale type list
SHALL remain in the proposal flow's tool schemas or descriptions. The `dashboard-proposal.schema.json`
`ProposalPanel.type` enum SHALL be exactly the same set.

#### Scenario: Divider is not offered in the proposal flow
- **WHEN** an agent inspects the `propose_dashboard`/`apply_proposal` panel `type` enum
- **THEN** `divider` is absent from the accepted values and only the five proposable types remain

#### Scenario: Deleted panel kinds are not proposable
- **WHEN** an agent calls `propose_dashboard` with a panel of `type: "collection"` (or `metric`, `chart`, `table`,
  `timeline`)
- **THEN** the tool rejects the panel's `type` as outside the accepted set

#### Scenario: Output panel is proposable
- **WHEN** an agent calls `propose_dashboard` with a panel of `type: "output"` and a valid, caller-owned `outputId`
- **THEN** the tool accepts it and the assembled proposal carries the output panel

### Requirement: Proposal panels accept a generic config passthrough for current panel types

Each proposal panel SHALL accept an optional generic `config` object that is carried through
`apply_proposal` to `POST /api/dashboards/apply-proposal` and merged into the config the backend
derives from the flat fields, then decoded by the SAME panel-create path (`PanelConfigCodec`). This
SHALL make every current panel config surface expressible via a proposal — for example text/markdown literal
`content` and image `imageUrl`/`caption`. On key conflict the explicit `config` SHALL win over a derived flat field,
EXCEPT that an `output` panel's flat `outputId` binding (and a `form` panel's flat `dataSourceId`) SHALL remain
authoritative, so the V41 pipeline-only binding guarantee cannot be bypassed via `config`.

#### Scenario: Literal markdown content via proposal config
- **WHEN** an agent applies a proposal whose markdown panel supplies `config: { content: "# Notes" }`
- **THEN** the applied panel persists as a markdown panel whose `config.content` is `"# Notes"`

#### Scenario: Output panel binding via proposal
- **WHEN** an agent applies a proposal whose `output` panel supplies a valid flat `outputId`
- **THEN** the applied panel persists as an output panel whose `config.outputId` is that Output id

#### Scenario: config cannot bypass pipeline-only binding
- **WHEN** an agent applies a proposal whose `output` panel `config` attempts to override `outputId` with a different
  id than the panel's flat `outputId`
- **THEN** the flat-field `outputId` remains authoritative and the V41 pipeline-only rule is still enforced

### Requirement: Image panel caption and chart Output annotation are set through their own MCP tools

The MCP tool surface SHALL accept an optional `caption` on an image panel's `config` (`create_content_panel` on
create, `update_panel` on update) and an optional `annotation` on a chart-kind Output's `config` (`add_output` on
create, `update_output` on update), and each tool description SHALL document its field. Omitting either field SHALL
leave the panel or Output without a caption/annotation.

#### Scenario: Agent creates an image panel with a caption
- **WHEN** an agent calls `create_content_panel` with `type: "image"` and `config: { imageUrl: "...",
  caption: "Hero photo — Reuters" }`
- **THEN** the created image panel persists with that `caption` and the dashboard renders its caption strip

#### Scenario: Agent sets a chart annotation on the Output
- **WHEN** an agent calls `update_output` on a chart-kind Output with `config.annotation: "Source: BLS"`
- **THEN** the Output persists with that `annotation` and every `output` panel bound to it renders it with the chart

#### Scenario: Omitting caption/annotation leaves none
- **WHEN** an agent creates an image panel without `caption`, or a chart-kind Output without `annotation`
- **THEN** no caption strip or annotation is rendered

### Requirement: Proposal flat fields seed non-data panel config and are inert on output panels

The proposal panel `config` field SHALL be optional and additive. A proposal panel carrying only flat fields (and no
`config`) SHALL still be accepted. For a panel with no flat `outputId`, the flat fields seed the created panel's config:
`content` for `text`/`markdown`, `url` for `image` (stored as `config.imageUrl` with `imageFit: "contain"`), and
`orientation` for `divider` (the backend accepts a `divider` proposal panel; the proposal schema's `type` enum and the MCP
`PANEL_TYPES` list only `text`, `markdown`, `image`, `output` and `form`). When a flat `outputId` is supplied, the
config is derived from it instead and `content`, `url` and `orientation` are not used. For an `output` panel that derivation is
`{ outputId }` only (before any `config` or `controls` is merged in): the legacy flat fields `fieldMapping`,
`aggregation`, `chartType`, `xAxisLabel`, `yAxisLabel`, `seriesColors`, `label`, `unit` and `sort` are decoded but never
applied (that configuration lives on the Output). When `config` is also supplied it is merged over the derived config
and wins on a key conflict, except that the flat `outputId` and `dataSourceId` stay authoritative. The in-app Proposal
Review UI, which posts to the same endpoint, SHALL continue to round-trip proposals.

#### Scenario: Flat content seeds a non-data panel
- **WHEN** an agent applies a proposal with a `markdown` panel carrying `content: "# Notes"` and no `config`
- **THEN** the created panel's `config.content` is `"# Notes"`

#### Scenario: Legacy chart flat fields are inert on an output panel
- **WHEN** an agent applies a proposal whose `output` panel carries `outputId` plus `chartType: "bar"` and
  `xAxisLabel: "Month"` and no `config`
- **THEN** the created panel's config is the same as for the same proposal without those two fields, and neither
  `chartType` nor `xAxisLabel` appears in it

#### Scenario: Proposal Review UI still round-trips
- **WHEN** a proposal is applied through the in-app Proposal Review UI
- **THEN** the dashboard and its panels are created correctly with no regression

### Requirement: update_panel MCP tool edits a panel in place
The MCP server SHALL expose `update_panel`, which partially updates a panel's `title`, `type`, `config` and/or
`appearance` through `PATCH /api/panels/:id` without recreating the panel. An omitted argument SHALL leave that field
unchanged. A `type` that differs from the panel's stored kind SHALL be rejected (a panel's kind is fixed at creation).
`config` is decoded against the stored kind; for an `output` panel, `config.outputId` rebinds the placement to a
different existing Output. Size and position are not `update_panel` arguments.

#### Scenario: Agent renames a placed panel
- **WHEN** an agent calls `update_panel` with a valid `panelId` and a new `title`
- **THEN** the tool updates the title, leaves every omitted field unchanged, and returns the updated panel

#### Scenario: Changing a panel's kind is rejected
- **WHEN** an agent calls `update_panel` with a `type` that differs from the panel's stored kind
- **THEN** the backend rejects the call with 400 and the panel is unchanged

#### Scenario: Agent rebinds an output panel to another Output
- **WHEN** an agent calls `update_panel` on an `output` panel with `config: { outputId: "<another Output id>" }`
- **THEN** the panel is bound to that Output
