## REMOVED Requirements

### Requirement: TablePanelConfig persists optional density and columnOrder
**Reason**: `TablePanelConfig` no longer exists — see `table-panel-column-widths`'s identical
HEL-904 rationale. `density`/`columnOrder` now live on the `table`-kind Output's own config.
**Migration**: See `table-panel-column-widths`'s migration note.
