## Purpose
Defines Output-scoped persisted column-sort state for table panels — the storage shape on
`TableOutputConfig`, its absent-field default, and how the stored sort is applied to the rows a
panel has loaded through the shared `useSortedRows` sorting system.

## ADDED Requirements

### Requirement: Sort state persists on the Output, not the panel placement
Table sort state SHALL be stored as `columnSort` on the Output's `TableOutputConfig`, in the
`{ key, direction }` shape the shared `useSortedRows` system already uses at runtime. It SHALL NOT
be stored on the panel placement record, and SHALL NOT be named `sort`, which is already taken by
`TimelineOutputConfig` in the same config module. Reading a `columnSort` that is absent or malformed
SHALL yield the unsorted default rather than an error.

Because the state lives on the Output, the sort SHALL apply to every panel bound to that Output
**on load**. Panels do not converge live: each panel holds its own sort state and its own Output
fetch, so sorting one panel SHALL NOT reorder another panel in the same session.

#### Scenario: A sorted table reopens sorted
- **WHEN** a table panel's column has been sorted and the Output config is re-read after a reload
- **THEN** the table renders with that column and direction still active

#### Scenario: Absent sort state renders in source order
- **WHEN** a table panel's Output config carries no `columnSort`
- **THEN** the table renders rows in their loaded order and every column header shows the neutral,
  unsorted affordance

#### Scenario: A malformed stored sort is ignored
- **WHEN** a stored `columnSort` is missing `key`, or carries a `direction` other than `"asc"` or
  `"desc"`
- **THEN** the table renders in source order rather than throwing

#### Scenario: A sort naming an unknown column renders source order
- **WHEN** a stored `columnSort.key` is not among the rendered columns
- **THEN** the table renders rows in their loaded order

#### Scenario: A second panel on the same Output picks the sort up on load
- **WHEN** panel A and panel B are bound to the same Output, panel A is sorted, and panel B is then
  loaded fresh
- **THEN** panel B renders with panel A's sort applied

#### Scenario: Sorting one panel does not move its sibling in the same session
- **WHEN** panel A and panel B are bound to the same Output and both are on screen, and panel A is
  sorted
- **THEN** panel B's row order is unchanged until it is next loaded

### Requirement: Sort state is written as a minimal config patch
Persisting a sort SHALL happen only in response to a user activating a column header — never on
mount, and never as a consequence of state seeded from the stored config — and SHALL send only the
changed key (`{ config: { columnSort } }`). The unsorted-default sentinel SHALL never be written. It SHALL NOT
re-send the rest of the Output's config, which is held as a per-mount client snapshot and would
overwrite a concurrent edit with stale values. The backend merges top-level config keys, so the
untouched keys survive.

#### Scenario: Merely rendering a never-sorted table panel attempts no config write
- **WHEN** a table panel whose Output carries no stored `columnSort` is rendered and no column
  header is activated
- **THEN** no config write is attempted, and in particular the unsorted-default sentinel key is
  never persisted

#### Scenario: A pending sort write survives closing the panel detail modal
- **WHEN** a column is sorted and the panel detail modal is closed before the debounce window
  elapses
- **THEN** the sort is still persisted, and reopening the panel shows it applied

#### Scenario: Sorting preserves the Output's other config
- **WHEN** a sort is persisted for an Output whose config carries `fieldMapping` and `columnOrder`
- **THEN** the request body carries only `columnSort`, and a subsequent read still returns the
  original `fieldMapping` and `columnOrder`

### Requirement: A caller who cannot write the Output sorts session-locally
The Output config write is owner-only. When the caller cannot write the Output, activating a sort
SHALL still sort the rows on screen and SHALL NOT attempt the write, SHALL NOT surface an error, and
SHALL NOT disable or hide the sort control. The sort simply does not persist.

#### Scenario: A grantee can sort a shared dashboard's table without an error
- **WHEN** a user who does not own the Output activates a column sort on a shared dashboard
- **THEN** the rows reorder, no config write is attempted, and no error is surfaced

#### Scenario: A non-owner's sort does not survive a reload
- **WHEN** a non-owner sorts a table panel and then reloads
- **THEN** the table renders with the Output's stored sort, not the non-owner's session sort

### Requirement: Ordering is numeric-aware and puts blanks last
A column whose values are numbers, or strings that represent finite numbers, SHALL order
numerically rather than lexically — including decimals, which a digit-run string comparison orders
incorrectly. This SHALL hold on the positional `rawRows` branch, where every value arrives as a
string. Blank values (`null`/`undefined`) SHALL order after all non-blank values in BOTH directions.
Rows with equal compared values SHALL retain their relative loaded order.

#### Scenario: Decimal-valued string columns sort numerically
- **WHEN** a column whose values arrive as the strings "1.5", "1.25", "1.9", "10" and "2" is sorted
  ascending
- **THEN** the rendered order is 1.25, 1.5, 1.9, 2, 10

#### Scenario: Blank cells sort last in both directions
- **WHEN** a column containing blank cells is sorted ascending, and then descending
- **THEN** the blank cells appear after every non-blank value in both orderings

#### Scenario: A blank cell is not treated as zero
- **WHEN** a numeric column containing blanks and negative values is sorted ascending
- **THEN** the blanks order after the negative values rather than between them

#### Scenario: Equal values retain loaded order
- **WHEN** several rows share the same value in the sorted column
- **THEN** those rows keep the relative order they had before the sort was applied

### Requirement: Sort applies across the whole loaded row set
The active sort SHALL be applied to every row the panel has loaded, not only to the rows currently
rendered. When additional rows are loaded, the newly appended rows SHALL be merged into the sorted
ordering rather than appended after it. Rows the panel has not fetched are not ordered by it.

#### Scenario: Sort spans all loaded rows
- **WHEN** a table has loaded more rows than fit on screen and a column is sorted
- **THEN** the ordering reflects every loaded row, not a reordering of a visible subset

#### Scenario: Newly loaded rows join the sorted order
- **WHEN** more rows are loaded while a sort is active
- **THEN** the added rows are placed by the comparator rather than appended in source order
