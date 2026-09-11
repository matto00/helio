# dataset-row-grid Specification

## Purpose
Lets a user view, edit, add, and delete a dataset source's rows in an editable, paged,
keyboard-navigable grid, reusing the existing shared `DataGrid` component.

## Requirements

### Requirement: View rows in a paged grid
The grid SHALL render a dataset source's rows using the paged row-listing endpoint, never
fetching or rendering the full row set at once for a large dataset.

#### Scenario: Large dataset renders without a full fetch
- **WHEN** a dataset source has more rows than one page
- **THEN** the grid requests successive pages via the paged endpoint as the user navigates,
  and does not issue a request for the entire row set

### Requirement: Inline cell edit with schema-driven validation
Each editable cell's editor SHALL be chosen from the field's declared type, and the grid SHALL
reject an edit that violates the declared schema before it reaches the server, surfacing the
error on the offending cell. Emptying an editable cell (backspacing a text field to empty,
clearing a numeric/timestamp field) SHALL always be treated as a clear attempt sending JSON
`null` — never an empty string — regardless of field type. A field declared `required` with
**no declared default** SHALL NOT be emptied by any means, for any editable field type
(including a text field backspaced to an empty string); a field declared `required` **with** a
declared default, or any non-required field, MAY be cleared, reverting to the default (or to
`null`, if non-required) on save, matching the server's own validation behavior.

#### Scenario: Required field with no default cannot be emptied
- **WHEN** a user empties a cell (by any means — backspacing a text field, clearing a
  numeric/timestamp field) for a field declared `required` with no declared default
- **THEN** the grid shows a validation error on that cell and does not submit the edit — this
  holds even though the server itself would otherwise accept an empty string for a `StringType`
  field, since the client never sends an empty string for an emptied cell in the first place

#### Scenario: Required field with a default can be cleared
- **WHEN** a user empties a cell for a field declared `required` that has a declared default
- **THEN** the grid accepts the clear, submits it as JSON `null` (never an empty string), and
  the server-persisted value reverts to the field's default

#### Scenario: Server-side field validation error
- **WHEN** the server rejects an edit with a field-level validation error
- **THEN** the grid surfaces that error on the specific offending cell, not a page-level toast

### Requirement: Stale-edit conflict is recoverable
An edit or delete rejected because the row changed since it was loaded (the row API's
`updatedAt` precondition, a `409` response) SHALL trigger a follow-up fetch of the row's current
value and let the user retry or discard — never a silent overwrite and never a generic,
non-actionable toast. A retry SHALL re-apply only the cell(s) the user actually edited on top of
the freshly-fetched current row — never the user's full stale row snapshot — so a retry cannot
overwrite a different cell another client changed concurrently.

#### Scenario: Concurrent edit detected
- **WHEN** a user submits an edit to a row that was modified elsewhere since the grid loaded it
- **THEN** the grid fetches the row's current value (a follow-up request — the `409` response
  itself carries no row data) and offers the user a retry (re-submit only their edited cell(s)
  against the current value) or discard action

#### Scenario: Concurrent delete detected on edit
- **WHEN** a user submits an edit to a row that was deleted elsewhere since the grid loaded it
- **THEN** the grid's follow-up fetch finds the row absent, shows "row was already deleted", and
  offers discard only (no retry)

#### Scenario: Concurrent conflict detected on delete
- **WHEN** a user deletes a row that was modified (not deleted) elsewhere since the grid loaded it
- **THEN** the grid fetches the row's current value and offers "delete anyway" (retry with the
  current `updatedAt`) or discard

### Requirement: Row delete and add-row
The grid SHALL support deleting a row and adding a new row, both persisting through the row
API, and both reflected in the grid without a full page reload.

#### Scenario: Delete a row
- **WHEN** a user deletes a row from the grid
- **THEN** the row is removed via the delete endpoint and disappears from the grid

#### Scenario: Add a row
- **WHEN** a user adds a new row via the grid
- **THEN** the row is appended via the row-write endpoint and appears in the grid

### Requirement: Full keyboard operability
The grid SHALL implement the W3C APG "Grid" keyboard pattern: arrow keys move the active cell
when not editing, `Enter`/`F2` enters edit mode on the active cell, `Enter` while editing commits
the edit and moves the active cell down one row, `Escape` while editing cancels and restores the
pre-edit value, `Tab`/`Shift+Tab` commits any in-progress edit and then moves focus out of the
grid entirely (not cell-to-cell — the grid holds exactly one roving `tabindex="0"` target at a
time), and a conforming visible focus indicator is maintained at every step. `Delete`/`Backspace`
on a focused row (cell) triggers row delete (behind a confirm) **only when no cell is currently
in edit mode** — while editing, `Delete`/`Backspace` edit the cell's text content as normal. All
interactive elements SHALL expose correct accessible names/roles (`role="grid"`/`"row"`/
`"gridcell"`), and validation/conflict errors SHALL be announced to assistive technology (e.g.
via `aria-live`/`role="alert"`), not only rendered visually.

#### Scenario: Keyboard-only row edit
- **WHEN** a user navigates to a cell using only the keyboard and edits its value
- **THEN** the edit can be entered, changed, and committed (or cancelled) without a pointer,
  with visible focus maintained throughout

#### Scenario: Enter commits and advances
- **WHEN** a user is editing a cell and presses `Enter`
- **THEN** the edit is committed and the active cell moves to the same column, one row down

#### Scenario: Tab commits an in-progress edit before leaving the grid
- **WHEN** a user is editing a cell and presses `Tab` or `Shift+Tab` (from focus inside the
  cell's own editor element, not the grid body)
- **THEN** the edit is committed (not discarded) and focus moves to the next/previous focusable
  element outside the grid — never to another cell inside the grid, and never left inside the
  editor by an unhandled native Tab traversal

#### Scenario: Blur commits an in-progress edit
- **WHEN** a user is editing a cell and its editor loses focus for any reason other than
  Tab/Escape (e.g. a mouse click elsewhere)
- **THEN** the edit is committed, consistent with Tab's behavior — never silently discarded or
  left in an ambiguous half-committed state

#### Scenario: Delete/Backspace does not fire row-delete while editing
- **WHEN** a user is editing a cell's text and presses `Delete` or `Backspace`
- **THEN** the keystroke edits the cell's text content; the row-delete action is not triggered

#### Scenario: Arrow navigation at a page boundary does not wrap or error
- **WHEN** a user presses `ArrowDown` on the last row of the current page, or `ArrowUp` on the
  first row of the current page
- **THEN** the active cell stays on that row (no wrap to another page, no error) — moving to an
  adjacent page requires the explicit pager control, not arrow-key navigation

#### Scenario: Keyboard navigation past the visible viewport
- **WHEN** a user arrow-navigates to a row not currently scrolled into view
- **THEN** that row is scrolled into view and receives visible focus — the active cell is never
  silently unmounted (this grid's fixed page size keeps every page under the shared grid
  component's virtualization threshold, so no row on the current page is ever unmounted)

#### Scenario: Explicit refresh reflects a concurrent change
- **WHEN** the dataset's rows change out-of-band (another client's edit) and the user triggers
  the grid's refresh action
- **THEN** the current page's rows are re-fetched and the concurrent change is reflected,
  without a full browser page reload
