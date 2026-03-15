## ADDED Requirements

### Requirement: Dashboard create route rejects malformed JSON bodies
The dashboard create route (`POST /api/dashboards`) SHALL return `400 Bad Request` when the request body contains malformed or type-invalid JSON.

#### Scenario: Type mismatch on name field
- **WHEN** a POST request is sent to `/api/dashboards` with body `{"name": 42}`
- **THEN** the route SHALL respond with `400 Bad Request`

#### Scenario: Structurally invalid JSON
- **WHEN** a POST request is sent to `/api/dashboards` with body `{invalid}`
- **THEN** the route SHALL respond with `400 Bad Request`
