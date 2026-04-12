## ADDED Requirements

### Requirement: GET /api/auth/me returns the authenticated user
The system SHALL expose `GET /api/auth/me` that requires a valid `Authorization: Bearer <token>` header. On success it SHALL return `200 OK` with the user object `{ id, email, displayName, createdAt }`. If the token is missing, invalid, or expired it SHALL return `401 Unauthorized`.

#### Scenario: Valid token returns current user
- **WHEN** a `GET /api/auth/me` request is made with a valid bearer token
- **THEN** the system returns `200 OK` with `{ id, email, displayName, createdAt }`
- **AND** the response SHALL NOT include the password hash

#### Scenario: Missing token returns 401
- **WHEN** a `GET /api/auth/me` request is made without an `Authorization` header
- **THEN** the system returns `401 Unauthorized` with `{"error": "Unauthorized"}`

#### Scenario: Expired token returns 401
- **WHEN** a `GET /api/auth/me` request is made with a token whose `expires_at` is in the past
- **THEN** the system returns `401 Unauthorized` with `{"error": "Unauthorized"}`
