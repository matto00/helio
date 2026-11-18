## ADDED Requirements

### Requirement: Keyboard focus leaving an opted-in popover's panel returns to the trigger
When a popover has opted into close-on-focus-out (its panel element is attached to the hook), and a Tab or Shift+Tab keypress moves focus from an element inside the panel to an element outside both the trigger and the panel, the popover MUST close and real DOM focus MUST be placed on the popover's trigger. Focus that leaves from the trigger itself, focus moved by a pointer, and focus leaving the document entirely MUST keep the pre-existing behavior (close only for the first two, nothing for the last; focus is not moved to the trigger). Popovers that have not attached a panel element MUST be unaffected.

#### Scenario: Shift+Tab from the first item of a portalled panel
- **GIVEN** an opted-in popover is open and focus is on the first focusable element inside its panel
- **WHEN** the user presses Shift+Tab
- **THEN** the popover closes and focus is on its trigger, not the page body

#### Scenario: Focus leaves from the trigger itself
- **GIVEN** an opted-in popover is open and focus is on its trigger (e.g. a combobox that keeps virtual focus on the trigger)
- **WHEN** the user presses Shift+Tab or Tab
- **THEN** the popover closes and focus moves to the element the browser chose, not back to the trigger

#### Scenario: Pointer moves focus elsewhere
- **GIVEN** an opted-in popover is open and focus is inside its panel
- **WHEN** a pointer action moves focus to a control outside the trigger and panel
- **THEN** the popover closes and focus stays on that control
