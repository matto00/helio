## ADDED Requirements

### Requirement: Dashboard creation endpoint
The system SHALL provide a `POST /api/dashboards` endpoint that creates a dashboard from a contract-defined request payload and returns the created dashboard with `201 Created`.

#### Scenario: Create dashboard with provided name
- **WHEN** the client sends `POST /api/dashboards` with a valid `name`
- **THEN** the system creates a dashboard
- **THEN** the response status is `201 Created`
- **THEN** the response body contains the created dashboard resource with a generated identifier and the provided name

#### Scenario: Create dashboard with blank name
- **WHEN** the client sends `POST /api/dashboards` with a blank `name`
- **THEN** the system creates a dashboard
- **THEN** the stored and returned dashboard name is normalized to the server default value

#### Scenario: Create dashboard with missing name
- **WHEN** the client sends `POST /api/dashboards` without a `name`
- **THEN** the system creates a dashboard
- **THEN** the stored and returned dashboard name is normalized to the server default value
