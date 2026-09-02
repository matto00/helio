# table-panel-column-widths Specification

## Purpose
Defines persisted per-column width storage for Table panels — a `columnWidths` field on
`TablePanelConfig` that survives reload and is updated via a debounced panel-config PATCH,
independent of the panel's data binding.

## Requirements

### Requirement: Resizing one column does not redistribute other columns' widths
Persisting a resize for one column SHALL only update that column's stored width. Previously stored
widths for other columns on the same panel SHALL remain unchanged.

#### Scenario: Resizing one column leaves other stored widths intact
- **WHEN** a Table panel already has stored widths for columns A and B, and the user resizes
  column A
- **THEN** the persisted config afterward has column A's new width and column B's width unchanged
