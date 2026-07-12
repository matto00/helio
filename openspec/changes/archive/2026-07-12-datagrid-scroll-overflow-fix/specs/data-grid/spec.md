## ADDED Requirements

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
