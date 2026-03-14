## ADDED Requirements

### Requirement: Backend-backed dashboard read flow
The system SHALL load dashboard state from the backend through async Redux read flows instead of relying on hardcoded starter dashboard data.

#### Scenario: Dashboards load through async Redux state
- **WHEN** the app triggers dashboard loading
- **THEN** Redux async state requests dashboard data from the backend
- **THEN** the dashboard list renders backend-backed dashboard data

#### Scenario: Dashboard loading shows simple fallback state
- **WHEN** dashboard data is still loading
- **THEN** the UI shows a simple loading fallback

#### Scenario: Dashboard loading failure shows simple fallback state
- **WHEN** dashboard loading fails
- **THEN** the UI shows a simple error fallback

### Requirement: Lazy panel read flow
The system SHALL load panel state lazily through async Redux read flows rather than eagerly loading all panels during app bootstrap.

#### Scenario: Panels load for a selected dashboard
- **WHEN** the frontend requests panels for a dashboard
- **THEN** Redux async state requests the panel read endpoint for that dashboard
- **THEN** the panel list renders the returned panel data

#### Scenario: Panel loading shows simple fallback state
- **WHEN** panel data is still loading
- **THEN** the UI shows a simple loading fallback

#### Scenario: Panel loading failure shows simple fallback state
- **WHEN** panel loading fails
- **THEN** the UI shows a simple error fallback
