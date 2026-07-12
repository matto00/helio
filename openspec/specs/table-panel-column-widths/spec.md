# table-panel-column-widths Specification

## Purpose
Defines persisted per-column width storage for Table panels — a `columnWidths` field on
`TablePanelConfig` that survives reload and is updated via a debounced panel-config PATCH,
independent of the panel's data binding.
## Requirements
### Requirement: Table panels persist per-column widths
`TablePanelConfig` SHALL carry an optional `columnWidths` field (a map from column key to pixel
width) alongside `dataTypeId` and `fieldMapping`. When absent or empty, a Table panel SHALL render
with `DataGrid`'s default/derived column widths. When present, `TableRenderer` SHALL pass the
stored widths to `DataGrid` as its `columnWidths` prop so the panel renders with the user's last
saved widths on every load, including after a full page reload.

#### Scenario: Panel with no stored widths renders default widths
- **WHEN** a Table panel's `config.columnWidths` is absent or empty
- **THEN** the panel's `DataGrid` renders each column at its default/derived width

#### Scenario: Panel with stored widths renders those widths on load
- **WHEN** a Table panel's `config.columnWidths` contains a width for one or more columns
- **THEN** on render, the panel's `DataGrid` applies those widths to the matching columns

#### Scenario: Stored widths survive a page reload
- **WHEN** a user resizes a Table panel's column, the resulting width is persisted, and the page
  is then reloaded
- **THEN** the panel renders with the previously resized column at its persisted width

### Requirement: Column-width changes are debounced and persisted independently of binding edits
When a user resizes a Table panel's column, the panel SHALL persist the new width via the existing
panel-config PATCH path, debounced so that rapid successive resizes of the same or different
columns do not each trigger a separate network request. The width-persisting PATCH SHALL NOT
include or alter `dataTypeId` or `fieldMapping`.

#### Scenario: Rapid resizes are coalesced into one persisted request
- **WHEN** a user drags a column's resize handle continuously for several seconds
- **THEN** only one PATCH request persisting the final width is sent after the drag settles, not
  one per intermediate width value

#### Scenario: Width persistence does not affect the panel's data binding
- **WHEN** a user resizes a Table panel's column
- **THEN** the panel's `dataTypeId` and `fieldMapping` remain unchanged after the resize persists

### Requirement: Resizing one column does not redistribute other columns' widths
Persisting a resize for one column SHALL only update that column's stored width. Previously stored
widths for other columns on the same panel SHALL remain unchanged.

#### Scenario: Resizing one column leaves other stored widths intact
- **WHEN** a Table panel already has stored widths for columns A and B, and the user resizes
  column A
- **THEN** the persisted config afterward has column A's new width and column B's width unchanged

