## REMOVED Requirements

### Requirement: Collection is a persisted panel kind
**Reason**: `collection` is no longer a `Panel` `type` value. HEL-904 collapsed the five
DataType-bound panel configs (`MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig`/
`CollectionPanelConfig`/`TimelinePanelConfig`) into a single `OutputPanelConfig(outputId)` —
`PanelConfigCodec` now recognizes only `text`/`markdown`/`image`/`divider`/`output` as panel
kinds (`backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala`). `collection` is
now an `OutputKind` (`Output.kind = Collection`), configured on the Output itself
(`CollectionOutputConfig`), not carried as a `Panel`'s own persisted `type`/`config`.
**Migration**: A collection panel is now created by creating a `collection`-kind Output (via a
pipeline) and placing it with `place_outputs`/`POST /api/panels` `type: "output"`,
`config: { outputId }`. The visual rendering contract for a placed collection Output is covered by
`collection-panel-rendering`, not this spec.

### Requirement: Collection config shape with tolerant defaults
**Reason**: See above — `CollectionPanelConfig`, the `type_id`/`field_mapping` panel columns, and
the `collection_options` panel column no longer exist; this shape now lives on `outputs.config`.
**Migration**: See above.

### Requirement: Collection config PATCH follows absent-vs-null semantics
**Reason**: See above — PATCH absent-vs-null semantics for this shape now apply to
`PATCH /api/outputs/:id`, not `PATCH /api/panels/:id`.
**Migration**: See above; the Output-side PATCH contract is covered by `mcp-output-tools`/the
Output routes spec, not this spec.

### Requirement: Collection config survives duplication and export
**Reason**: See above — duplication/export now carry `outputId`, not an inline collection config,
per `dashboard-export-import`.
**Migration**: See above.

### Requirement: Collection appears in every panel-type contract surface
**Reason**: See above — `collection` is an `OutputKind` enum value, not a `Panel` `type` value, so
it no longer appears in the panel-`type` contract surfaces (JSON Schema `Panel.type` enum, MCP
`create_panel`-family tools — themselves already removed, see `mcp-panel-composition-tools`'s
archived `create_panel`/`bind_panel` removal).
**Migration**: See above.
