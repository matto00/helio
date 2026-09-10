# table-panel-column-pinning Specification

## Purpose
Defines the persisted pin/unpin affordance for Table panel columns — a `pinnedColumns` field on
`TableOutputConfig` (the Output the panel is bound to, not the panel placement record) that
freezes leading columns to the left edge, and its interaction with column order.

## Requirements

### Requirement: Column header exposes a keyboard-operable pin toggle
Each column header in a `full`-variant Table panel SHALL expose a pin/unpin control with an
accessible name identifying the action and target column, operable via keyboard alone (DESIGN.md
§8), alongside the existing sort/filter/format affordances.

#### Scenario: Pinning via keyboard
- **WHEN** a user tabs to a column header's pin control and activates it with the keyboard
- **THEN** that column becomes pinned, with no mouse interaction required

#### Scenario: Unpinning via keyboard
- **WHEN** a user activates the pin control of an already-pinned column via keyboard
- **THEN** that column is unpinned and returns to the normal scrolling region

### Requirement: Pinning a column pins every leading column ahead of it in order
Pin state SHALL be constrained to a contiguous, leading run of the current column order: pinning
a column also pins every column ordered ahead of it that is not already pinned. Unpinning a
column also unpins every column ordered after it that is currently pinned, so the pinned set
always remains the leading N columns of the current order.

#### Scenario: Pinning a non-leading column pins its leading siblings too
- **WHEN** no columns are pinned and a user pins the 3rd column in the current order
- **THEN** columns 1, 2, and 3 all become pinned

#### Scenario: Unpinning a leading column unpins everything after it
- **WHEN** columns 1, 2, and 3 are pinned and a user unpins column 1
- **THEN** columns 1, 2, and 3 all become unpinned, and the persisted `pinnedColumns` value is
  written as an explicit empty array, never an omitted field

#### Scenario: Reordering a pinned column past the pinned boundary updates the pinned set
- **WHEN** columns 1 and 2 are pinned and the user reorders column 3 to be first
- **THEN** the pinned set is recomputed against the new order so it remains a leading, contiguous
  run (the previously-pinned columns' pin state is preserved by position, not by identity), and
  the recomputed value is persisted immediately rather than left to drift from `columnOrder`

### Requirement: Pinned-column set persists on the bound Output's config
The `pinnedColumns` set SHALL persist as a flat sibling field on `TableOutputConfig` (alongside
`columnOrder`/`columnSort`/`columnFilters`/`columnFormats`), written via the same debounced,
silently-degrading Output-config PATCH idiom already used for `columnSort`/`columnFilters`, and
SHALL be restored unchanged across panel-detail-modal open/close and page reload. Clearing the
pinned set SHALL always write an explicit empty array; the field SHALL never be omitted from a
write that is meant to clear it, since the backend config merge is shallow and leaves an omitted
key's prior value intact.

#### Scenario: Pin state survives modal close and reopen
- **WHEN** a user pins a column, closes the panel-detail modal, and reopens it
- **THEN** the same column remains pinned

#### Scenario: Pin state survives reload
- **WHEN** a user pins a column and reloads the page
- **THEN** the same column remains pinned after the panel re-renders

#### Scenario: Clearing the pinned set writes an explicit empty array
- **WHEN** a user unpins the last remaining pinned column
- **THEN** the persisted Output config write sends `pinnedColumns: []` explicitly rather than
  omitting the field

### Requirement: Pin-toggle icon does not visually overlap the header label
When a column's pin toggle renders in its header cell, the column's label text SHALL be
constrained (max-width, overflow, ellipsis) so it never paints underneath or behind the pin-toggle
icon, regardless of how long the label is or how many columns are currently pinned.

#### Scenario: Long label with columns pinned does not overlap the pin icon
- **WHEN** a table panel has 3 or more columns pinned and a header label is long enough to
  otherwise overflow its cell
- **THEN** the label ellipsizes before reaching the pin-toggle icon's bounding box, in both light
  and dark themes

### Requirement: Pin toggle and its focus ring stay within the header cell at small/coarse-pointer viewports
At a coarse-pointer or narrow (≤430px) viewport, the pin toggle's rendered control SHALL remain at
least 44×44px (the touch-target floor) and both the control's box and its focus-visible ring SHALL
render fully inside the bounds of the header cell that contains it — neither may be clipped by the
cell's own overflow boundary.

#### Scenario: Pin toggle and focus ring are unclipped at a coarse-pointer viewport
- **WHEN** a table panel is viewed at a real viewport of 430px width or less with a coarse pointer
- **THEN** the pin-toggle button's box and its computed focus-ring extent both render fully inside
  the header `<th>` that contains it, and the control itself is at least 44×44px, in both light and
  dark themes

#### Scenario: Desktop/mouse viewport is unaffected
- **WHEN** a table panel is viewed at a desktop viewport with a fine (mouse) pointer
- **THEN** the header row's height is unaffected by the coarse-pointer sizing rule above
