## ADDED Requirements

### Requirement: PATCH /api/users/:id/update endpoint exists
The backend MUST expose a `PATCH /api/users/:id/update` endpoint that accepts a user preference
payload and returns 200 OK.

#### Scenario: User preference update returns 200
- **WHEN** a client sends `PATCH /api/users/:id/update` with `{ "fields": ["zoomLevel"], "user": { "zoomLevel": 1.2 } }`
- **THEN** the backend returns HTTP 200 with an empty response body

### Requirement: User preference update is a noop on the backend
Until a `user_preferences` table is created, the endpoint MUST accept the payload, validate its
shape, and return 200 without persisting anything.

#### Scenario: No data is persisted
- **GIVEN** no user_preferences table exists in the database
- **WHEN** a client sends a user preference update
- **THEN** the backend returns 200 OK without attempting a database write
- **AND** the endpoint does not return an error
