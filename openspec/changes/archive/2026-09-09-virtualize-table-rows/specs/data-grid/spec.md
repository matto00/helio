## ADDED Requirements

### Requirement: DataGrid virtualizes rows above a threshold
`DataGrid`'s `full` variant SHALL window rendering of `<tr>` elements when the row count exceeds
a fixed small-table threshold: only rows within (or near) the visible scroll viewport SHALL be
mounted in the DOM, while the table SHALL preserve the correct total scrollable height as though
every row were mounted. Below the threshold, `DataGrid` SHALL render every row normally with no
windowing overhead.

#### Scenario: Large row count is windowed
- **WHEN** `DataGrid` is rendered with `variant="full"` and a row count above the virtualization
  threshold
- **THEN** the number of mounted `<tr>` data-row elements at any given scroll position is bounded
  well below the total row count, and the container's scrollable height matches the total row
  count at the active density's row height

#### Scenario: Small row count bypasses virtualization
- **WHEN** `DataGrid` is rendered with `variant="full"` and a row count at or below the
  virtualization threshold
- **THEN** every row is mounted as a `<tr>` with no windowing applied

### Requirement: Virtualized row height tracks density
`DataGrid`'s virtualization SHALL compute row height from the density-derived row height already
in effect for the active `DataGridDensity` (`"condensed"` | `"normal"` | `"spacious"`), never a
fixed constant independent of density.

#### Scenario: Row height changes with density under virtualization
- **WHEN** `DataGrid` is rendered with `variant="full"`, a row count above the virtualization
  threshold, and a given `density`
- **THEN** the windowed row height used for scroll-position and total-height math matches that
  density's row height, and changes accordingly if `density` changes

### Requirement: Virtualized rows preserve screen-reader row semantics
`DataGrid`'s `full` variant SHALL expose `aria-rowcount` on the table reflecting the true total
row count (header-inclusive) regardless of virtualization state, and SHALL expose `aria-rowindex`
on each mounted data `<tr>` reflecting its true, window-independent 1-based position. Any spacer
row rendered to preserve scroll geometry under virtualization SHALL be excluded from the
accessibility tree (`aria-hidden="true"`).

#### Scenario: Row count and index are unaffected by windowing
- **WHEN** `DataGrid` is rendered with `variant="full"` and a row count above the virtualization
  threshold
- **THEN** the table's `aria-rowcount` reflects the true total row count, each mounted data row's
  `aria-rowindex` reflects its true position rather than its position within the mounted window,
  and neither spacer row is exposed to assistive technology

### Requirement: Virtualization preserves existing full-variant behaviors
Windowing SHALL NOT change the externally observable behavior of `table-layout: fixed` column
widths, column resize, sort, filter, or column pinning (`position: sticky` leading-run columns).
Windowed and non-windowed rendering of the same row/column data SHALL produce equivalent column
widths and pinned-column offsets.

#### Scenario: Column widths unchanged under virtualization
- **WHEN** `DataGrid` is rendered with `variant="full"`, explicit `columnWidths`, and a row count
  above the virtualization threshold
- **THEN** every rendered column's width matches the corresponding non-virtualized rendering's
  column width, with no column collapse

#### Scenario: Column pinning unchanged under virtualization
- **WHEN** `DataGrid` is rendered with `variant="full"`, one or more pinned leading columns, and a
  row count above the virtualization threshold
- **THEN** pinned columns retain their `position: sticky` cumulative offsets identically to the
  non-virtualized rendering
