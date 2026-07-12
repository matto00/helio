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

### Requirement: DataGrid provides its own scroll container
`DataGrid` SHALL establish its own scrollable container (`overflow: auto` on both axes) around its
`<table>`, independent of any ancestor element, for both the `full` and `preview` variants. The
table header SHALL remain visible (sticky, pinned to the top of the grid's own scroll container)
while the body scrolls vertically.

#### Scenario: Vertical scroll keeps the header visible
- **WHEN** `DataGrid` renders more rows than fit in its available height and the user scrolls down
- **THEN** the table body scrolls while the header row (`<thead>`) remains visible, pinned to the
  top of the grid

#### Scenario: Horizontal scroll for wide tables
- **WHEN** `DataGrid` renders more columns than fit in its available width
- **THEN** the grid offers horizontal scroll for the table content rather than clipping or wrapping
  columns off-screen

#### Scenario: Full and preview variants both scroll
- **WHEN** `DataGrid` is rendered with `variant="full"` or `variant="preview"` and its content
  overflows the grid's box in either dimension
- **THEN** the grid scrolls that dimension itself — the scroll behavior is not dependent on the
  variant

### Requirement: Consumers must not clip DataGrid with an ancestor overflow
No ancestor element between a `DataGrid` instance and its nearest sized/positioned container SHALL
set `overflow: hidden` (or any property that would clip scrollable content, e.g. `overflow: clip`).
`DataGrid` SHALL be the container responsible for offering scroll when its content overflows;
ancestor wrappers SHALL size it (via flex/grid sizing) but SHALL NOT hard-clip it.

#### Scenario: Panel card does not clip table content
- **WHEN** a table-type panel's `DataGrid` content overflows the panel card's available height
- **THEN** the panel card (`.panel-grid-card`) does not hard-clip the content — the grid's own
  scroll container handles it, and the card boundary is respected without a hidden-overflow clip
  applied to the card itself

#### Scenario: Panel detail modal view body does not clip table content
- **WHEN** a table-type panel is viewed in the panel detail modal's view mode and its `DataGrid`
  content overflows the available body height
- **THEN** the modal's view body (`.panel-detail-modal__view-body`) does not hard-clip the content —
  the grid's own scroll container handles it

### Requirement: DataGrid consumers rely on the variant-based density default

Every current `DataGrid` consumer SHALL render `<DataGrid>` without an explicit `density` prop, so each surface inherits the variant default (`preview` -> `condensed`, `full` -> `normal`) rather than hardcoding or duplicating density logic per surface.

Covered consumers: `TypeDetailPanel`, `SourceDetailPanel`, `PipelinePreviewModal`, `StepCard`,
`SqlTab`, `TableRenderer`. A consumer MAY pass an explicit `density` override only when its surface
has a documented reason to diverge from the variant default.

#### Scenario: Preview-variant consumers render condensed by default
- **WHEN** `TypeDetailPanel`, `SourceDetailPanel`, `PipelinePreviewModal`, `StepCard`, or `SqlTab`
  renders its `DataGrid` instance
- **THEN** the rendered grid has condensed row spacing (`ui-data-grid--condensed`), matching the
  `preview` variant default

#### Scenario: Full-variant consumer renders normal by default
- **WHEN** `TableRenderer` renders its `DataGrid` instance for a table panel
- **THEN** the rendered grid has normal row spacing (`ui-data-grid--normal`), matching the `full`
  variant default

### Requirement: DataGrid density spacing and type scale match project design tokens

`DataGrid`'s per-density CSS rules SHALL use the project's spacing (`--space-*`) and type (`--text-*`) design tokens for padding and font size, rather than hardcoded pixel values.

This keeps density changes consistent with `DESIGN.md`'s spacing and type scales as those scales evolve.

#### Scenario: Each density mode uses design-token values
- **WHEN** `DataGrid` renders in `condensed`, `normal`, or `spacious` density
- **THEN** the cell padding and font size for that mode are set via `--space-*` and `--text-*`
  custom properties, not hardcoded pixel literals

