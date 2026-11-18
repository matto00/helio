## ADDED Requirements

### Requirement: Hovering the last rail row does not shift it
On the desktop dashboard list rail, hovering the last row with the page scrolled to its end SHALL NOT move any row and
SHALL NOT change the page's scroll height; the row's three-dot trigger SHALL be revealed inside the row.

#### Scenario: Last row, page scrolled to its end, short window
- **WHEN** the user scrolls the page to its end in a 1280x400 window (light or dark) and hovers the last dashboard-list
  row
- **THEN** the row's bounding box before and after the hover is the same (within 1px), the document's scroll height does
  not change, and the row's three-dot trigger is visible inside the row
