## ADDED Requirements

### Requirement: Starter component render coverage
The system SHALL include colocated `@testing-library/react` coverage for the starter dashboard and panel list components so their current render behavior is protected.

#### Scenario: Dashboard list renders starter dashboard state
- **WHEN** `DashboardList` is rendered with the current starter dashboard state
- **THEN** the component shows the dashboards section heading
- **THEN** the component renders the dashboard name from state

#### Scenario: Panel list shows empty state
- **WHEN** `PanelList` is rendered with no panels in state
- **THEN** the component shows the panels section heading
- **THEN** the component shows the empty-state message

#### Scenario: Component tests remain colocated
- **WHEN** starter component tests are added
- **THEN** they live next to the component source files they cover
