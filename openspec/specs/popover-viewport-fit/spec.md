# popover-viewport-fit Specification

## Purpose
The user menu, the dashboard appearance editor and the panel provenance popover keep every item and control reachable inside the viewport in short windows, on desktop and phone, and keep keyboard focus inside the panel on open.

## Requirements

### Requirement: User menu keeps every item reachable in the viewport
The user menu (opened from the desktop rail and from the phone bottom nav) SHALL open with every one of its items inside
the viewport with at least an 8px margin, or, when the viewport is shorter than the menu on both sides of its trigger,
SHALL cap its height to the roomier side and scroll inside itself so every item can be reached and clicked. It SHALL
NOT paint at an unfitted position before its fitted position is applied.

#### Scenario: Desktop rail in a short window
- **WHEN** the user opens the user menu from the desktop rail in a 1280x400 window, in light or dark theme
- **THEN** the menu's last item lies inside the viewport, and `document.elementFromPoint` at that item's centre
  (after scrolling it into view inside the menu when the menu is capped) returns the item

#### Scenario: Phone bottom nav in a short window
- **WHEN** the user opens the user menu from the phone bottom nav in a 390-wide short window, in light or dark theme
- **THEN** the menu's last item lies inside the viewport and `document.elementFromPoint` at its centre returns the item

#### Scenario: Already fitting
- **WHEN** the menu fits on its preferred side of the trigger
- **THEN** it opens on that side at the same position as before this change

### Requirement: Dashboard appearance editor keeps every control reachable in the viewport
The dashboard appearance editor popover SHALL open with its last control (the "Save dashboard style" submit button) inside the viewport,
or, when the viewport is shorter than the editor on both sides of its trigger, SHALL cap its height to the roomier side
and scroll inside itself so every control can be reached. It SHALL keep at least an 8px margin from the left viewport
edge.

#### Scenario: Short desktop window
- **WHEN** the user opens the dashboard appearance editor in a 1280x400 window, in light or dark theme
- **THEN** the "Save dashboard style" button lies inside the viewport (after scrolling inside the editor when capped)
  and `document.elementFromPoint` at its centre returns it

#### Scenario: Not rendered on phone
- **WHEN** the viewport is 768px wide or narrower
- **THEN** the dashboard appearance editor is not rendered at all (editing is out of scope on phone), so there is no
  phone placement to fit, and this change does not make it render there

### Requirement: Provenance popover keeps all of its content reachable in the viewport
The panel provenance popover SHALL open with all of its content reachable inside the viewport: on its preferred side when
it fits, on the other side when that side has more room, otherwise capped to the roomier side and scrolling inside
itself. It SHALL keep at least an 8px margin from both horizontal viewport edges.

#### Scenario: Trigger mid-viewport in a short window
- **WHEN** the user opens the provenance popover from a panel whose trigger sits where neither side holds the whole
  popover, in a short desktop or phone window, in light or dark theme
- **THEN** the popover stays inside the viewport and its last section, scrolled into view inside the popover,
  satisfies `document.elementFromPoint` at its centre

### Requirement: An already-fitting popover is left unchanged and documented
When a probe at short desktop and phone windows in both themes shows that one of the three popovers cannot clip, that
popover's placement SHALL be left unchanged and the delivery SHALL record the probe measurements that show it fits.

#### Scenario: Probe shows no clipping
- **WHEN** the probe for a popover finds every item inside the viewport at every probed size and theme
- **THEN** no placement change is made to that popover and the PR states the measurements

### Requirement: A fitted popover still receives focus on open
Each popover converted to measured placement SHALL move keyboard focus into its panel on open exactly as before the
change (the user menu's first item; the provenance popover's dialog, or its Checks heading when opened from the
"Invalid data" badge), in a real browser.

#### Scenario: Opening by keyboard
- **WHEN** the user opens a converted popover with the keyboard
- **THEN** `document.activeElement` is inside the panel once it is visible

### Requirement: A fitted popover re-fits when its content grows
When a converted popover's content grows after it opened (provenance moving from loading to loaded or to an error; the
appearance editor showing its contrast warning or a save error), the popover SHALL re-fit so all of its content stays
reachable, without dispatching a synthetic window resize.

#### Scenario: Provenance opened on a cache miss
- **WHEN** the user opens a provenance popover whose content has not been fetched yet, in a short window
- **THEN** once the content has loaded, its last section is reachable and `document.elementFromPoint` at its centre
  (scrolled into view inside the popover) returns it

#### Scenario: Provenance keeps its design height cap
- **WHEN** a provenance popover whose content is taller than 480px opens in a tall window
- **THEN** its height does not exceed the smaller of 70% of the viewport height and 480px, and its content scrolls

### Requirement: A failed appearance save keeps the editor open with keyboard focus on Save
While a dashboard appearance save is in flight, the Save control MUST remain focusable and be announced as unavailable (`aria-disabled="true"`), and further submits MUST be ignored. If the save fails, the editor MUST stay open, keep the picked preset, show the error, and keep focus on Save.

#### Scenario: Keyboard save fails
- **GIVEN** the appearance editor is open, a preset has been picked with the keyboard, and the save request will fail
- **WHEN** the user activates Save with the keyboard
- **THEN** the error is shown, the editor stays open with the picked preset still selected, and focus is on Save

#### Scenario: A further focus move after the failure does not discard the pick
- **GIVEN** a keyboard save has failed and focus is on Save
- **WHEN** the user presses Shift+Tab
- **THEN** focus moves to the previous control inside the editor and the editor stays open
