## ADDED Requirements

### Requirement: Most-recent dashboard default selection
The system SHALL auto-select the first dashboard in the response (which the backend guarantees is the most recently updated) when dashboard data loads and no prior selection exists.

#### Scenario: Newest dashboard is selected by default
- **WHEN** dashboard data is loaded into frontend state
- **THEN** the selected dashboard is the first item in the response (most recently updated per backend sort contract)

#### Scenario: Existing selection is preserved when still valid
- **WHEN** dashboard data refreshes and the current selected dashboard still exists
- **THEN** the frontend preserves the current selection instead of overriding it

### Requirement: Clickable dashboard selection flow
The system SHALL allow a user to change the active dashboard from a clickable list rendered on the left side of the app shell.

#### Scenario: User selects a dashboard from the list
- **WHEN** a user clicks a dashboard in the selection list
- **THEN** the frontend updates the selected dashboard

#### Scenario: Panel loading remains lazy and selection-driven
- **WHEN** the selected dashboard changes
- **THEN** the frontend requests panels for the newly selected dashboard
- **THEN** the frontend does not eagerly request panels for unselected dashboards

#### Scenario: New dashboard becomes selected after create
- **WHEN** a user creates a dashboard from the dashboard list
- **THEN** the created dashboard becomes the selected dashboard
- **AND** the existing selection behavior continues to apply for later manual changes

#### Scenario: Panel creation uses selected dashboard context
- **WHEN** a user creates a panel from the panel list
- **THEN** the create flow targets the currently selected dashboard
- **AND** the panel refresh flow remains scoped to that selected dashboard
