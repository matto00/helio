## MODIFIED Requirements

### Requirement: Keyboard focus leaving an opted-in popover's panel returns to the trigger
When a popover has opted into close-on-focus-out (its panel element is attached to the hook), and a keyboard Tab or Shift+Tab moves focus from an element inside the panel to outside the panel, the popover MUST close and real DOM focus MUST land as if the panel sat in the tab order immediately after its trigger: after Shift+Tab, focus MUST be on the popover's trigger; after a forward Tab, focus MUST be on the first tabbable control that follows the trigger in document order, within the trigger's focus scope (the enclosing open modal dialog when there is one, else the document), excluding the panel's own contents. When no tabbable control follows the trigger in that scope, forward Tab MUST put focus on the first tabbable control of an enclosing open modal dialog (matching its wrap-around), or on the trigger when there is no such dialog, and never on the page body. Focus that leaves from the trigger itself, focus moved by a pointer, and focus leaving the document entirely MUST keep the pre-existing behavior (close only for the first two, nothing for the last; focus is not moved). Popovers that have not attached a panel element MUST be unaffected, and a popover that keeps keyboard Tab inside its own panel is unaffected because focus never leaves it.

#### Scenario: Shift+Tab from the first item of a portalled panel
- **GIVEN** an opted-in popover is open and focus is on the first focusable element inside its panel
- **WHEN** the user presses Shift+Tab
- **THEN** the popover closes and focus is on its trigger, not the page body

#### Scenario: Forward Tab off the last item of a portalled panel
- **GIVEN** an opted-in popover is open and focus is on the last focusable element inside its panel (for a menu whose items are not sequential tab stops, any item)
- **WHEN** the user presses Tab
- **THEN** the popover closes and focus is on the first tabbable control after the trigger in document order, not on the trigger and not on the page body

#### Scenario: Forward Tab inside an open modal dialog
- **GIVEN** an opted-in popover whose trigger is inside an open modal dialog is open and focus is on its last item
- **WHEN** the user presses Tab
- **THEN** the popover closes and focus is on the next tabbable control after the trigger inside that dialog, or the dialog's first tabbable control when nothing follows the trigger

#### Scenario: Focus leaves from the trigger itself
- **GIVEN** an opted-in popover is open and focus is on its trigger (e.g. a combobox that keeps virtual focus on the trigger)
- **WHEN** the user presses Shift+Tab or Tab
- **THEN** the popover closes and focus moves to the element the browser chose, not back to the trigger

#### Scenario: Pointer moves focus elsewhere
- **GIVEN** an opted-in popover is open and focus is inside its panel
- **WHEN** a pointer action moves focus to a control outside the trigger and panel
- **THEN** the popover closes and focus stays on that control
