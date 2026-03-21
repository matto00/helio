## ADDED Requirements

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
