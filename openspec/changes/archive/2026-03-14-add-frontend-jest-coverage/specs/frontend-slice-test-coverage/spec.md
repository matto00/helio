## ADDED Requirements

### Requirement: Dashboard and panel slice coverage
The system SHALL include Jest coverage for the starter dashboard and panel Redux slices so current reducer behavior is protected as frontend features expand.

#### Scenario: Dashboard slice creates dashboards
- **WHEN** the dashboard slice add action is dispatched with a name
- **THEN** the resulting state contains a new dashboard item with the provided name

#### Scenario: Panel slice creates panels
- **WHEN** the panel slice add action is dispatched with a dashboard identifier and title
- **THEN** the resulting state contains a new panel item linked to the referenced dashboard

#### Scenario: Slice tests remain colocated
- **WHEN** frontend slice tests are added
- **THEN** they live next to the slice source files they cover
