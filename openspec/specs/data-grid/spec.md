# data-grid Specification

## Purpose
Defines the shared `DataGrid` primitive's rendering contract (rows/columns, empty state, variant/
density defaults, and default cell formatting) that every table-shaped surface in the app renders
through, replacing per-surface duplicated table markup.

## Requirements
### Requirement: DataGrid renders rows and columns
`DataGrid` SHALL render a set of `rows: Record<string, unknown>[]` as a table. When `columns` is
omitted, the column set SHALL be derived as the union of keys across the first 50 rows, in
first-seen order. When `columns` is provided, it SHALL be used verbatim, in the given order.

#### Scenario: Columns derived from row keys
- **WHEN** `DataGrid` is rendered with `rows` and no `columns` prop
- **THEN** the rendered header row shows one column per distinct key found across the first 50
  rows, in the order each key was first seen

#### Scenario: Explicit columns override derivation
- **WHEN** `DataGrid` is rendered with a `columns` prop
- **THEN** the rendered header row shows exactly the columns provided, in the given order,
  regardless of the keys present on `rows`

### Requirement: DataGrid renders an empty state when there are no rows
When `rows` is an empty array, `DataGrid` SHALL render an empty-state message instead of a table,
and SHALL NOT render a `<table>` element. The message SHALL be the `emptyText` prop when provided,
or `"No data to preview."` by default. (Consumers that need a loading/unbound skeleton — e.g. a
table panel before any data has been requested — render that skeleton themselves outside
`DataGrid`, rather than passing an empty `rows` array and expecting a skeleton back.)

#### Scenario: Empty rows array shows the default empty-state message
- **WHEN** `DataGrid` is rendered with `rows={[]}` and no `emptyText` prop
- **THEN** the component renders the text "No data to preview." and no `<table>` element is
  present

#### Scenario: Empty rows array shows custom empty-state message
- **WHEN** `DataGrid` is rendered with `rows={[]}` and `emptyText="Source returned no rows."`
- **THEN** the component renders the text "Source returned no rows." and no `<table>` element is
  present

### Requirement: DataGrid supports full and preview variants
`DataGrid` SHALL accept a `variant` prop of `"full"` or `"preview"`. `variant="preview"` SHALL be
read-only (no interactive cell affordances) and SHALL default `density` to `"condensed"` unless
`density` is explicitly provided. `variant="full"` SHALL default `density` to `"normal"` unless
`density` is explicitly provided.

#### Scenario: Preview variant defaults to condensed density
- **WHEN** `DataGrid` is rendered with `variant="preview"` and no `density` prop
- **THEN** the rendered grid has condensed row spacing

#### Scenario: Full variant defaults to normal density
- **WHEN** `DataGrid` is rendered with `variant="full"` and no `density` prop
- **THEN** the rendered grid has normal row spacing

#### Scenario: Explicit density overrides the variant default
- **WHEN** `DataGrid` is rendered with `variant="preview"` and `density="spacious"`
- **THEN** the rendered grid has spacious row spacing

### Requirement: DataGrid formats cell values consistently by default
When a column has no `render` function, `DataGrid` SHALL format each cell value as follows:
`null` or `undefined` renders as `—`; object values render as their JSON string representation;
all other values render via their string representation.

#### Scenario: Null and undefined values render as an em dash
- **WHEN** a row's value for a column is `null` or `undefined` and the column has no `render`
- **THEN** the cell displays `—`

#### Scenario: Object values render as JSON
- **WHEN** a row's value for a column is an object and the column has no `render`
- **THEN** the cell displays the value's `JSON.stringify` representation

### Requirement: DataGrid supports custom column rendering
`ColumnDef` SHALL accept an optional `render(row, value)` function. When present, `DataGrid`
SHALL use its return value for that column's cell content instead of the default formatter.

#### Scenario: Custom render overrides default formatting
- **WHEN** a column defines `render` and `DataGrid` renders a row for that column
- **THEN** the cell displays the output of `render(row, value)` instead of the default-formatted
  value

