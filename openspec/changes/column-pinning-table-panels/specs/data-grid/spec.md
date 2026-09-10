## ADDED Requirements

### Requirement: DataGrid renders pinned leading columns as sticky-left
When the `full`-variant `DataGrid` is given a non-empty `pinnedColumns` prop (interpreted as a
leading prefix of the `columns` array it was given, in the order given), each pinned column's
header cell, filter-input cell (when the filter row is expanded), and body cells SHALL render
with `position: sticky` and a computed `left` offset equal to the sum of the widths of all pinned
columns ahead of it (using each column's live drag-resize width when a resize is in progress,
else its `columnWidths` entry, falling back to `col.width`, then `DEFAULT_COLUMN_WIDTH`, when
unset — the same fallback chain `DataGrid` already uses for `appliedWidth`), so pinned columns
remain visible while the rest of the table
scrolls horizontally beneath them. The `preview` variant SHALL ignore `pinnedColumns` and never
render sticky-left columns.

#### Scenario: Single pinned column stays visible while scrolling
- **WHEN** the `full`-variant `DataGrid` renders with one pinned column and the table's scroll
  container is scrolled horizontally
- **THEN** the pinned column's header and body cells remain at the left edge of the visible
  table area, unaffected by the horizontal scroll offset

#### Scenario: Multiple pinned columns stack with cumulative offsets
- **WHEN** two or more columns are pinned, with different `columnWidths` entries
- **THEN** each pinned column after the first renders with a `left` offset equal to the sum of
  the widths of every pinned column ahead of it, so pinned columns render left-to-right with no
  overlap or gap

#### Scenario: preview variant never renders sticky-left columns
- **WHEN** `DataGrid` is rendered with `variant="preview"` and a non-empty `pinnedColumns` prop
- **THEN** no column renders with `position: sticky` on the horizontal axis

### Requirement: Pinned cells render with a panel-surface-matched background and correct stacking order
Pinned body cells SHALL render with a background matching the panel's own surface (the same
background every other opaque-looking element on that panel uses, respecting a user-customized or
translucent panel background rather than overriding it), so scrolling content never visibly shows
through beneath a pinned column any more than it would through any other panel chrome. Doubly-
sticky corner cells (a pinned column's header cell, and, when the filter row is expanded, its
filter-input cell — both sticky on the top axis from the existing header/filter-row behavior and
the left axis from pinning) SHALL render above every singly-sticky cell they can visually overlap
during a scroll.

#### Scenario: Pinned body cells paint the panel's own surface, matching other panel chrome
- **WHEN** at least one column is pinned and the table is scrolled horizontally
- **THEN** a scrolling column's cell content is no more visible underneath a pinned column's body
  cell than it would be underneath any other opaque-looking element on that same panel — on a
  panel with no custom appearance, this means fully opaque; on a panel with a customized or
  translucent background, the pinned cell matches that same background exactly

#### Scenario: Pinned header cell stays above scrolling header cells during horizontal scroll
- **WHEN** the header row is pinned to the top (existing behavior) and at least one column is
  pinned, and the table is scrolled both vertically and horizontally
- **THEN** the pinned column's header cell renders above any scrolling column's header or body
  content that passes beneath it

#### Scenario: Pinned filter-input cell stays above scrolling cells when the filter row is expanded
- **WHEN** the per-column filter row is expanded and at least one column is pinned
- **THEN** the pinned column's filter-input cell renders above scrolling content passing beneath
  it, exactly like the pinned header cell

### Requirement: Pinned/scrolling boundary is visually distinct
When at least one column is pinned and the table is scrollable horizontally, `DataGrid` SHALL
render a visible, non-inset trailing shadow (drawn from the existing scroll-edge shadow token)
on the last pinned column's cells, distinguishing the frozen region from the scrolling region, in
both light and dark themes.

#### Scenario: Separator renders between pinned and scrolling regions
- **WHEN** at least one column is pinned
- **THEN** a themed trailing shadow is visible along the right edge of the last pinned column's
  cells, distinguishing it from the scrolling columns to its right
