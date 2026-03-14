## ADDED Requirements

### Requirement: Frontend API service modules
The system SHALL provide typed frontend service modules for dashboard and panel read operations against the backend HTTP API.

#### Scenario: Fetch dashboards through a service module
- **WHEN** the frontend needs dashboard data
- **THEN** it uses a typed service module to request the dashboard read endpoint

#### Scenario: Fetch panels through a service module
- **WHEN** the frontend needs panel data for a selected dashboard
- **THEN** it uses a typed service module to request the dashboard-specific panel read endpoint

#### Scenario: Service layer remains reusable
- **WHEN** future frontend behavior needs dashboard or panel HTTP reads
- **THEN** those reads can reuse the same service modules instead of calling transport logic directly from UI components
