## MODIFIED Requirements

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
