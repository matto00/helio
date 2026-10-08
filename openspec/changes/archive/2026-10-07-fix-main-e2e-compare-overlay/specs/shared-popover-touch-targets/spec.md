## ADDED Requirements

### Requirement: ui-select popover stays inside the viewport
The shared `ui-select` popover listbox (`.ui-select__panel`, `position: fixed`) SHALL keep every option reachable inside the viewport. When the panel would extend past the viewport's bottom edge below its trigger, it SHALL open above the trigger if that side has more room, and in either placement its height SHALL be capped to the room available so the remaining options scroll inside the listbox. When the whole panel fits below the trigger, placement and height SHALL be unchanged.

#### Scenario: Trigger near the bottom of the viewport
- **WHEN** a `ui-select` whose trigger sits in the lower part of a 900px-tall viewport is opened
- **THEN** the listbox's top and bottom edges are both inside the viewport and every option can be clicked without scrolling the page

#### Scenario: Trigger with room below
- **WHEN** a `ui-select` whose full listbox fits between the trigger and the viewport bottom is opened
- **THEN** the listbox opens directly below the trigger at its natural height
