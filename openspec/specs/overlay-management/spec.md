## Purpose
Defines overlay management for popovers and dropdown menus: closing the active overlay on Escape or an outside click, and enforcing mutual exclusion so at most one overlay is open at a time.

## Requirements

### Requirement: Escape key closes any open overlay
The system SHALL close the currently open popover or dropdown menu when the user presses the Escape key, regardless of which element currently has keyboard focus.

#### Scenario: Escape closes open ActionsMenu
- **WHEN** an ActionsMenu dropdown is open
- **AND** the user presses Escape
- **THEN** the dropdown closes

#### Scenario: Escape closes open DashboardAppearanceEditor
- **WHEN** the dashboard appearance editor popover is open
- **AND** the user presses Escape
- **THEN** the popover closes

#### Scenario: Escape closes open PanelAppearanceEditor
- **WHEN** the panel appearance editor popover is open
- **AND** the user presses Escape
- **THEN** the popover closes

#### Scenario: Escape is a no-op when no overlay is open
- **WHEN** no overlay is open
- **AND** the user presses Escape
- **THEN** no visible state change occurs

### Requirement: Mutual exclusion between overlays
The system SHALL ensure that at most one popover or dropdown is visible at any time. Opening any overlay SHALL close the previously open one.

#### Scenario: Opening ActionsMenu closes open DashboardAppearanceEditor
- **WHEN** the dashboard appearance editor popover is open
- **AND** the user clicks an ActionsMenu trigger button
- **THEN** the dashboard appearance editor closes
- **AND** the ActionsMenu opens

#### Scenario: Opening DashboardAppearanceEditor closes open ActionsMenu
- **WHEN** an ActionsMenu dropdown is open
- **AND** the user clicks the "Customize dashboard" button
- **THEN** the ActionsMenu closes
- **AND** the dashboard appearance editor opens

#### Scenario: Opening a second ActionsMenu closes the first
- **WHEN** one ActionsMenu dropdown is open
- **AND** the user clicks a different ActionsMenu trigger button
- **THEN** the first ActionsMenu closes
- **AND** the second ActionsMenu opens

### Requirement: Click-outside closes the active overlay
The system SHALL close a popover or dropdown when the user clicks outside its bounds.

#### Scenario: Click outside ActionsMenu closes it
- **WHEN** an ActionsMenu dropdown is open
- **AND** the user clicks outside the dropdown and its trigger
- **THEN** the dropdown closes

#### Scenario: Click outside DashboardAppearanceEditor closes it
- **WHEN** the dashboard appearance editor popover is open
- **AND** the user clicks outside the popover and its trigger
- **THEN** the popover closes

### Requirement: Escape on a popover inside a modal closes only the popover
When a portalled popover (an actions menu, a select list, the output schema panel, or any other popover built on the
shared portal-popover behaviour) is open inside an open modal dialog, Escape SHALL close that popover only and return
focus to its trigger; the modal SHALL stay open. Escape SHALL still reach window-level Escape handlers. A further
Escape with no popover open SHALL close the modal as before.

#### Scenario: Actions menu inside a modal
- **WHEN** an actions menu inside an open modal is open and the user presses Escape
- **THEN** the menu closes, focus returns to its trigger, and the modal stays open

#### Scenario: Second Escape closes the modal
- **WHEN** the user presses Escape again with no popover open
- **THEN** the modal closes
