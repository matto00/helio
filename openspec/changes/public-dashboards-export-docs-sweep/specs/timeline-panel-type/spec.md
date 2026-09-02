## REMOVED Requirements

### Requirement: Timeline is a persisted panel kind
**Reason**: `timeline` is no longer a `Panel` `type` value — see `collection-panel-type`'s
"Collection is a persisted panel kind" removal for the identical HEL-904 rationale
(`TimelinePanelConfig` was one of the five DataType-bound configs collapsed into
`OutputPanelConfig(outputId)`). `timeline` is now an `OutputKind`, configured on the Output.
**Migration**: See `collection-panel-type`'s migration note; the timeline rendering contract lives
in `TimelineRenderer.tsx`, not a panel-level spec.

### Requirement: Timeline config shape with tolerant defaults
**Reason**: See above — `TimelinePanelConfig`/`timeline_options` no longer exist on `panels`; this
shape now lives on `outputs.config`.
**Migration**: See above.

### Requirement: Timeline config PATCH follows absent-vs-null semantics
**Reason**: See above.
**Migration**: See above; PATCH semantics for this shape now apply to `PATCH /api/outputs/:id`.

### Requirement: Timeline config survives duplication and export
**Reason**: See above — duplication/export now carry `outputId`, not an inline timeline config.
**Migration**: See above.
