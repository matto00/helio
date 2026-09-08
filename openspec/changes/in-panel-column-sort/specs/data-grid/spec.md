## ADDED Requirements

### Requirement: The full variant renders sortable column headers through the shared sorting system
In the `"full"` variant, when a sort handler is supplied, `DataGrid` SHALL render each column header
as an activatable sort control using the shared sort affordance — the same direction glyph,
`aria-sort` vocabulary and whole-header-is-the-button interaction the app's other sortable tables
use. Activating a header SHALL toggle that column between ascending and descending; activating a
different column SHALL start that column at ascending and clear the previous column's direction.
There SHALL NOT be a third, unsorted activation state. The `"preview"` variant SHALL NOT render sort
controls.

#### Scenario: Activation toggles between ascending and descending
- **WHEN** a column header is activated three times in succession
- **THEN** the column sorts ascending, then descending, then ascending again

#### Scenario: Sorting a second column resets to ascending and clears the first
- **WHEN** one column is sorted descending and a different column's header is then activated
- **THEN** the second column sorts ascending and the first column shows the neutral affordance

#### Scenario: The preview variant has no sort controls
- **WHEN** `DataGrid` renders with `variant="preview"`
- **THEN** no header sort control is rendered

### Requirement: Sorted headers expose accessible sort state
The sorted column's `th` SHALL carry `aria-sort="ascending"` or `"descending"`, and every other
sortable column's `th` SHALL carry `aria-sort="none"`, per the WAI-ARIA sortable-table pattern. The
control SHALL have an accessible name identifying its column, SHALL be reachable by keyboard, and
SHALL be activatable with Enter and Space. The direction SHALL be conveyed by a glyph, never by
color alone.

#### Scenario: aria-sort tracks the active column and direction
- **WHEN** a column is sorted ascending and then descending
- **THEN** that column's `th` reports `aria-sort="ascending"` then `"descending"`, and every other
  sortable column reports `"none"`

#### Scenario: Keyboard activates the sort
- **WHEN** the sort control has keyboard focus and Enter or Space is pressed
- **THEN** the column's sort advances exactly as it would on click

### Requirement: The sort control does not interfere with column resize
The header sort control and the existing resize handle SHALL remain independently operable in the
`"full"` variant, and the resize handle SHALL NOT be nested inside the sort control's button.
Interacting with the resize handle — by pointer or by its keyboard affordance — SHALL NOT change the
column's sort state.

#### Scenario: Resizing does not trigger a sort
- **WHEN** a column's resize handle is dragged or nudged with its keyboard affordance
- **THEN** the column's width changes and its sort state is unchanged
