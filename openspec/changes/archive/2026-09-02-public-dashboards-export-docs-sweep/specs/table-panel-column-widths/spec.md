## REMOVED Requirements

### Requirement: Table panels persist per-column widths
**Reason**: `TablePanelConfig` no longer exists — HEL-904 collapsed it into `OutputPanelConfig
(outputId)`; `columnWidths` now lives on the `table`-kind Output's own config
(`outputs.config`), not a `Panel` column.
**Migration**: Per-column width storage is now scoped to the Output; see the Output routes /
`mcp-output-tools` spec for its current PATCH contract.

### Requirement: Column-width changes are debounced and persisted independently of binding edits
**Reason**: See above — the debounced-persist behavior now targets `PATCH /api/outputs/:id`, not
`PATCH /api/panels/:id`.
**Migration**: See above.
