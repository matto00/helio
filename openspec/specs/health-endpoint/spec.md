# health-endpoint Specification

## Purpose
TBD - created by archiving change add-health-endpoint. Update Purpose after archive.
## Requirements
### Requirement: Health check returns 200 OK
The system SHALL expose a `GET /health` endpoint that returns HTTP 200 OK with a JSON
body `{"status":"ok"}` when the backend process is running.

#### Scenario: Successful health check
- **WHEN** a client sends `GET /health`
- **THEN** the server responds with HTTP 200 OK and body `{"status":"ok"}`

### Requirement: Health endpoint is unauthenticated
The `GET /health` endpoint SHALL NOT require authentication tokens or session cookies.
Any client — including infrastructure probes — SHALL be able to call it without credentials.

#### Scenario: Unauthenticated probe succeeds
- **WHEN** a Cloud Run startup probe sends `GET /health` with no Authorization header
- **THEN** the server responds with HTTP 200 OK (not 401 or 403)

### Requirement: Health endpoint is outside the API prefix
The `GET /health` route SHALL be registered at the root path, not under `/api`, so it
is independent of API versioning and prefix routing.

#### Scenario: Root path resolution
- **WHEN** a client sends `GET /health` (not `GET /api/health`)
- **THEN** the server responds with HTTP 200 OK

