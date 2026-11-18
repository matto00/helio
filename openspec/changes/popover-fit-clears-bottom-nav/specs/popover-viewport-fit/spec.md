## ADDED Requirements

### Requirement: Popovers clear the phone bottom nav and the bottom safe area
Every popover placed by the shared vertical fit (the provenance popover from a panel trigger or a citation chip, the
shared actions menu, the Select listbox and the dashboard appearance editor) SHALL treat the band at the bottom of the
viewport occupied by the phone bottom nav, and the bottom safe-area inset, as outside the usable area: when it opens
below its trigger, its bottom edge SHALL sit at least 8px above the top of that band, and when it does not fit there it
SHALL flip above or cap its height and scroll inside itself exactly as it does at the window edge. The band SHALL be
measured from the rendered layout. When the bottom nav is not rendered (desktop widths) or the popover is inside an
open modal dialog that covers the nav, only the safe-area inset SHALL be excluded.

#### Scenario: Provenance popover at 390x844
- **WHEN** the user opens a provenance popover on a phone dashboard at 390x844 from a trigger low enough that the
  popover, fitted to the whole window, would reach into the bottom nav's band, in light or dark theme
- **THEN** the popover's bottom edge lies at least 8px above the bottom nav's top edge, and
  `document.elementFromPoint` at the centre of its last item (scrolled into view inside the popover when capped)
  returns that item, and `document.elementsFromPoint` there contains no part of the bottom nav

#### Scenario: Provenance popover in a short phone viewport
- **WHEN** the same open happens in a short phone viewport (390x400), in light
  or dark theme
- **THEN** the popover flips above or caps its height so that it does not reach into the nav's band, and its last item
  satisfies the same `document.elementFromPoint` check

#### Scenario: Desktop placement unchanged
- **WHEN** a popover using the shared fit opens at a desktop width (no bottom nav rendered) with no safe-area inset
- **THEN** it is placed exactly as before this change
