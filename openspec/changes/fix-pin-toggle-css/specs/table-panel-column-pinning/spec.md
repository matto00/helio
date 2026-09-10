## ADDED Requirements

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
