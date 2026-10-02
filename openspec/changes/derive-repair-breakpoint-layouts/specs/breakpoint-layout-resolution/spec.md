## Purpose

Defines how the dashboard grid chooses the layout for each responsive breakpoint at render time, so panels never
overlap or overflow, while authored layouts are honoured exactly and nothing is persisted without a user edit.

## ADDED Requirements

### Requirement: Valid authored layouts render exactly as saved
When a breakpoint's saved layout contains an entry for every rendered panel, every entry lies within that
breakpoint's column count (`x >= 0`, `w >= 1`, `x + w <= cols`), and no two entries overlap, the grid SHALL render
those positions and sizes unchanged, including intentional vertical and horizontal gaps. The grid MUST NOT compact
a valid authored layout.

#### Scenario: Authored layout with gaps is untouched
- **WHEN** the active breakpoint's saved layout is valid and leaves an empty row between two panels
- **THEN** every panel renders at its saved x, y, w, h and the empty row remains

### Requirement: A breakpoint with no authored layout is derived from the nearest authored breakpoint
When the active breakpoint has no saved entry for a panel, the grid SHALL derive that panel's position from the
nearest other breakpoint (by column-count distance; ties prefer the wider) that holds an entry for it and whose saved
entries are within that breakpoint's column bounds, using the repaired (overlap-free) form of that breakpoint when it
overlaps. The derived position SHALL scale x and w to the active breakpoint's column count, then be compacted so no
panels overlap and the source's reading order (y, then x) is preserved. A partially populated breakpoint serves as a
source for the panels it holds. Saved entries at the active breakpoint are never moved by derivation of missing
panels. If no breakpoint can serve as a source the grid SHALL place panels in default non-overlapping positions.

#### Scenario: Only lg is authored
- **WHEN** a dashboard has a saved lg layout and empty md, sm and xs layouts
- **THEN** at each of md, sm and xs the panels render non-overlapping, within the column count, in the source's
  reading order

#### Scenario: Saved layout carries stale panel ids
- **WHEN** a breakpoint's saved layout has entries for panel ids that no longer exist and omits live panels
- **THEN** the omitted live panels are derived from the nearest authored breakpoint, not placed at default width

#### Scenario: The only authored breakpoint overlaps
- **WHEN** lg is the only populated breakpoint and its saved layout has overlapping panels
- **THEN** md, sm and xs are derived from lg's repaired form, non-overlapping and in lg's repaired reading order

#### Scenario: Overlapping and partial
- **WHEN** a breakpoint's saved layout both overlaps and omits some live panels
- **THEN** the saved entries are first made overlap-free in place, then each omitted panel is derived and placed in
  free space without moving them

### Requirement: An invalid saved layout is repaired at render
When the active breakpoint's saved layout overlaps or has entries outside the column bounds (for example 12-column
coordinates stored under a 10-column breakpoint), the grid SHALL repair it at render so the result is in bounds and
overlap-free, keeping each panel as close to its saved position as possible.

#### Scenario: Out-of-bounds coordinates under md
- **WHEN** the md layout holds lg-sized coordinates (`x + w` up to 12)
- **THEN** at md every panel is within 10 columns and no two panels overlap

#### Scenario: Overlapping saved layout
- **WHEN** the active breakpoint's saved layout has two overlapping panels
- **THEN** the rendered layout has no overlap

### Requirement: Derived and repaired layouts persist only on an edit at that breakpoint
Viewing a dashboard, resizing the window across breakpoints, or editing at a different breakpoint MUST NOT write a
derived or repaired layout, mark the dashboard as having unsaved layout changes, or add an undo/redo history entry.
When the user drags or resizes at a breakpoint, the layout persisted SHALL carry that breakpoint's edited layout and
leave every other breakpoint's saved layout as it was.

#### Scenario: View only
- **WHEN** a dashboard with missing md/sm/xs layouts is opened and the window is resized across breakpoints
- **THEN** no layout PATCH is sent and the dirty indicator never appears

#### Scenario: Edit at md
- **WHEN** the user drags a panel at the md breakpoint
- **THEN** the persisted layout contains the md edit and the previously saved lg layout unchanged

### Requirement: Grid breakpoint selection agrees with the stack boundary
The grid SHALL select lg at container width >= 1440px, md at >= 1100px, sm at >= 768px and the phone stack below
768px; a container width exactly equal to a boundary belongs to the wider breakpoint.

#### Scenario: Exact boundary widths
- **WHEN** the container width is exactly 1440, 1100 or 768
- **THEN** the active breakpoint is lg, md or sm respectively
