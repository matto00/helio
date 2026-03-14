## ADDED Requirements

### Requirement: Panel creation endpoint
The system SHALL provide a `POST /api/panels` endpoint that creates a panel from a contract-defined request payload and returns the created panel with `201 Created`.

#### Scenario: Create panel with provided title
- **WHEN** the client sends `POST /api/panels` with a valid `dashboardId` and `title`
- **THEN** the system creates a panel for the referenced dashboard
- **THEN** the response status is `201 Created`
- **THEN** the response body contains the created panel resource with a generated identifier, the referenced dashboard identifier, and the provided title

#### Scenario: Create panel with blank title
- **WHEN** the client sends `POST /api/panels` with a valid `dashboardId` and a blank `title`
- **THEN** the system creates a panel
- **THEN** the stored and returned panel title is normalized to the server default value

#### Scenario: Create panel with missing title
- **WHEN** the client sends `POST /api/panels` with a valid `dashboardId` and no `title`
- **THEN** the system creates a panel
- **THEN** the stored and returned panel title is normalized to the server default value

#### Scenario: Reject panel creation without dashboard identifier
- **WHEN** the client sends `POST /api/panels` without `dashboardId`
- **THEN** the response status is `400 Bad Request`
- **THEN** the system does not create a panel

#### Scenario: Reject panel creation for missing dashboard
- **WHEN** the client sends `POST /api/panels` with a `dashboardId` that does not exist
- **THEN** the response status is `404 Not Found`
- **THEN** the system does not create a panel
