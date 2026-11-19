# portal-popover-hook Specification

## Purpose
TBD - created by archiving change portal-popover-hook. Update Purpose after archive.

## Requirements

### Requirement: usePortalPopover hook encapsulates trigger ref and position state
The `usePortalPopover` hook SHALL export a trigger ref, open/close state, panel position, and
an open handler so that popover components can share the portal/positioning pattern without
duplicating inline logic. A popover portalled into a modal `<dialog>` SHALL align to its trigger:
modal dialogs that host portalled popovers MUST NOT leave a lingering `transform` (or other
containing-block-establishing property) after their entrance animation, so that the popover's
`position: fixed` coordinates resolve against the viewport rather than being displaced by the
dialog's origin.

#### Scenario: Hook provides trigger ref and position on open
- **WHEN** a component calls `usePortalPopover` and the returned `handleOpen` is invoked
- **THEN** `isOpen` becomes true and `panelPos` is populated from the trigger element's
  `getBoundingClientRect()`

#### Scenario: Hook close resets state
- **WHEN** the returned `close` function is called
- **THEN** `isOpen` becomes false

#### Scenario: Popover portalled into a modal dialog aligns to its trigger
- **WHEN** a `Select` popover is opened inside an animated modal `<dialog>` (e.g. the panel-creation
  modal) and is portalled into that dialog
- **THEN** the panel aligns to its trigger — its top edge sits just below the trigger's bottom edge
  and its left edge matches the trigger's left edge — because the dialog's entrance animation leaves
  no lingering containing-block `transform` at rest

### Requirement: All popover components use usePortalPopover
All popover components (`ActionsMenu`, `DashboardAppearanceEditor`, `UserMenu`, `Select`) SHALL
use `usePortalPopover` and MUST NOT duplicate trigger-ref and position-state logic inline.

#### Scenario: ActionsMenu uses hook
- **WHEN** ActionsMenu renders its popover
- **THEN** it uses the shared hook for open/close and position state

#### Scenario: DashboardAppearanceEditor uses hook
- **WHEN** DashboardAppearanceEditor renders its popover
- **THEN** it uses the shared hook for open/close and position state

#### Scenario: Select uses hook
- **WHEN** Select renders its dropdown panel
- **THEN** it uses the shared hook for open/close and position state

#### Scenario: UserMenu uses hook
- **WHEN** UserMenu renders its menu popover
- **THEN** it uses the shared hook for open/close and position state

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
