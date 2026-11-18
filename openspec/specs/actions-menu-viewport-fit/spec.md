# actions-menu-viewport-fit Specification

## Purpose
The shared ⋮ actions menu opens fully reachable inside the viewport from any trigger position, so every item can be
seen and clicked.

## Requirements

### Requirement: Actions menu fits the viewport vertically
The actions menu SHALL open on its requested side of the trigger (below by default) when the whole menu fits between
the trigger and that viewport edge with an 8px margin. When it does not fit there but fits on the other side, it SHALL
open on the other side when the other side has more room. Otherwise it SHALL open on the side with more room, with
its height capped to that room, and the remaining items SHALL be reachable by scrolling inside the menu. No item SHALL ever be placed
outside the viewport unreachably.

#### Scenario: Last dashboard-list row in a short viewport
- **WHEN** the user opens the ⋮ menu of the last row of the dashboard list in a viewport where the menu does not fit
  below the trigger
- **THEN** the menu opens above the trigger, its last item lies inside the viewport, and `document.elementFromPoint`
  at that item's centre returns the item

#### Scenario: Room below
- **WHEN** the user opens the ⋮ menu of a trigger with enough room below it
- **THEN** the menu opens below the trigger exactly as before

#### Scenario: No side has room
- **WHEN** the viewport is shorter than the menu on both sides of the trigger
- **THEN** the menu opens on the roomier side, stays inside the viewport, and its items scroll inside it so every item
  can be reached and clicked

### Requirement: Actions menu is not shown before it is placed
The actions menu SHALL NOT paint at an unfitted position before its fitted position is applied.

#### Scenario: Opening near the bottom edge
- **WHEN** the menu opens from a trigger near the bottom of the viewport
- **THEN** it is first visible at its fitted position, with no frame shown past the viewport edge

### Requirement: Actions menu stays inside the viewport horizontally
The actions menu SHALL be aligned to the trigger's right edge and SHALL keep at least an 8px margin from the left viewport edge.

#### Scenario: Trigger closer to the left edge than the menu's width
- **WHEN** the menu opens from a trigger whose right edge is nearer the left viewport edge than the menu is wide, in a
  390px-wide viewport
- **THEN** the whole menu is inside the viewport horizontally, at least 8px from the left edge

### Requirement: Touch-sized menu fits on a phone
On a phone-width viewport, where menu items are touch-sized, the actions menu SHALL satisfy the same vertical fit.

#### Scenario: Multi-item touch menu in a short phone-width viewport
- **WHEN** the user opens the step sheet's "Step actions" ⋮ menu (inside the modal dialog) in a 390x300 viewport where
  neither side of the trigger holds the whole menu
- **THEN** the menu is capped to the roomier side and scrolls inside itself, and its last item (reached with End) lies
  inside the viewport and `document.elementFromPoint` at its centre returns the item

#### Scenario: Single-item phone menu cannot breach the viewport
- **WHEN** a pipeline Output's ⋮ menu (one touch-sized item) is opened from a trigger that is tappable (above the 68px
  bottom nav)
- **THEN** it already fits below the trigger (lowest tappable trigger bottom about 776, menu ends at about 838 within
  844), so it opens below exactly as before

### Requirement: Hovering the last rail row does not shift it
On the desktop dashboard list rail, hovering the last row with the page scrolled to its end SHALL NOT move any row and
SHALL NOT change the page's scroll height; the row's three-dot trigger SHALL be revealed inside the row.

#### Scenario: Last row, page scrolled to its end, short window
- **WHEN** the user scrolls the page to its end in a 1280x400 window (light or dark) and hovers the last dashboard-list
  row
- **THEN** the row's bounding box before and after the hover is the same (within 1px), the document's scroll height does
  not change, and the row's three-dot trigger is visible inside the row
