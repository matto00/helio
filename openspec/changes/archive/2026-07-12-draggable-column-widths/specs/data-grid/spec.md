## ADDED Requirements

### Requirement: DataGrid supports column-width drag-resize in the full variant
`DataGrid` SHALL render a drag handle on the right edge of each column header when
`variant="full"`. Dragging a handle SHALL adjust that column's width only, down to a minimum of
60px, without redistributing width to or from any other column. `DataGrid` SHALL accept optional
`columnWidths?: Record<string, number>` (applied widths, keyed by column `key`) and
`onColumnResize?: (key: string, width: number) => void` (fired as the user drags, reporting the
live width) props. `variant="preview"` SHALL NOT render a resize handle and SHALL ignore
`columnWidths`/`onColumnResize` if passed.

#### Scenario: Full variant renders a resize handle per column
- **WHEN** `DataGrid` is rendered with `variant="full"`
- **THEN** each column header renders a drag handle on its right edge

#### Scenario: Preview variant renders no resize handle
- **WHEN** `DataGrid` is rendered with `variant="preview"`
- **THEN** no column header renders a drag handle, regardless of whether `columnWidths` or
  `onColumnResize` is passed

#### Scenario: Dragging a handle resizes only that column
- **WHEN** a user drags one column's resize handle to a new position
- **THEN** that column's width changes to reflect the drag and `onColumnResize` fires with that
  column's `key` and the new width, while every other column's width is unchanged

#### Scenario: Drag is clamped to the minimum width
- **WHEN** a user drags a column's resize handle to a position that would make the column narrower
  than 60px
- **THEN** the column's width is clamped to 60px and `onColumnResize` fires with `60`

#### Scenario: Applied columnWidths override derived/default width
- **WHEN** `DataGrid` is rendered with `variant="full"` and a `columnWidths` prop containing a
  width for a given column `key`
- **THEN** that column renders at the given width instead of its default/derived width

### Requirement: DataGrid column-resize does not interfere with ancestor drag/resize handles
The resize handle rendered by `DataGrid` SHALL stop propagation of its own `mousedown`/`pointerdown`
events and SHALL use element markup and class names distinct from any ancestor drag or resize
handle (e.g. `PanelGrid`'s card-drag handle and corner-resize handle), so that dragging a column
border never starts a panel-level drag or resize gesture.

#### Scenario: Column-resize drag does not trigger panel drag
- **WHEN** a `TableRenderer`'s `DataGrid` is rendered inside a `PanelGrid` panel card and the user
  presses down on a column's resize handle and drags
- **THEN** only the column resizes — the panel card does not move and no panel drag-start fires
