## REMOVED Requirements

### Requirement: Panel composition tools accept image caption and chart annotation
**Reason**: There is no chart panel kind to carry `annotation`: the canonical panel kinds are
`text/markdown/image/divider/output/form` (`schemas/panels/create-panel-request.schema.json` `type` enum), and a
chart is an Output kind rendered inside an `output` panel. `annotation` is a chart-kind Output `config` key
(`OUTPUT_CONFIG_KEYS_DOC` in `helio-mcp/src/tools/outputs.ts`; `OutputConfigValidation.KnownKeys` chart set in the
backend). The image `caption` half is still true and is restated in the ADDED requirement below.
**Migration**: Set a chart annotation with `add_output`/`update_output` on the chart-kind Output's `config.annotation`;
set an image caption on the image panel's `config.caption` (see "Image panel caption and chart Output annotation are
set through their own MCP tools").

### Requirement: Proposal config passthrough is backward compatible
**Reason**: Its scenario "Flat-field-only proposal is unchanged" promises that `fieldMapping`/`aggregation`/`chartType` etc. produce "the same created panels as before this change"; on an `output` panel those fields are decoded but never applied (`ProposalPanelSupport.buildDataConfig` derives `{ outputId }` only; `schemas/dashboards/dashboard-proposal.schema.json`: every listed field's description says "Legacy field, decoded but never applied", and `fieldMapping`/`aggregation`/`label`/`unit` additionally open with "Deprecated and ignored: this panel-level field has no effect on the applied panel"). Restated against current behaviour.
**Migration**: See "Proposal flat fields seed non-data panel config and are inert on output panels".

### Requirement: update_panel MCP tool
**Reason**: False on both scenarios. `update_panel` (`helio-mcp/src/tools/write.ts`) takes `title`, `type`, `config`
and `appearance` (no `w`/`h`/position; placement is set by the layout tools), and an output panel's `config.outputId`
IS patchable, rebinding the placement to a different Output (`OutputPanel.Patch` in the backend).
**Migration**: See "update_panel MCP tool edits a panel in place".

## ADDED Requirements

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
