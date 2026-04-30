## ADDED Requirements

### Requirement: PATCH /api/users/me/update endpoint exists
The backend MUST expose a `PATCH /api/users/me/update` endpoint that accepts a user preference
payload and returns 204 No Content. The authenticated user's identity is derived from the session
token — no `:id` path parameter is required.

#### Scenario: User preference update returns 204
- **WHEN** a client sends `PATCH /api/users/me/update` with `{ "fields": ["zoomLevel"], "user": { "zoomLevel": 1.2 } }`
- **THEN** the backend returns HTTP 204 No Content

### Requirement: User preference update is a noop on the backend
Until a `user_preferences` table is created, the endpoint MUST accept the payload, validate its
shape, and return 204 without persisting anything.

#### Scenario: No data is persisted
- **GIVEN** no user_preferences table exists in the database
- **WHEN** a client sends a user preference update
- **THEN** the backend returns 204 No Content without attempting a database write
- **AND** the endpoint does not return an error
