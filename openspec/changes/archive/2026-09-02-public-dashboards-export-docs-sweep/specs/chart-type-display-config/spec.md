## REMOVED Requirements

### Requirement: ChartPanelConfig carries optional per-chart-type display options
**Reason**: `ChartPanelConfig` no longer exists — HEL-904 collapsed it, along with the other four
DataType-bound panel configs, into `OutputPanelConfig(outputId)`. `chartOptions` now lives on the
`chart`-kind Output's own config (`outputs.config`), not a `Panel` column.
**Migration**: Per-chart-type display options are now scoped to the Output; see the Output routes
/ `mcp-output-tools` spec for its current shape and PATCH contract.
