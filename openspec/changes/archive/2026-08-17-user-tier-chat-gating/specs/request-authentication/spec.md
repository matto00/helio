# request-authentication Delta Spec

## MODIFIED Requirements

### Requirement: GET /api/auth/me returns the authenticated user
The system SHALL expose `GET /api/auth/me` that requires a valid session (cookie or PAT bearer, per
the "Protected routes require a valid session" requirement). On success it SHALL return `200 OK` with
the user object `{ id, email, displayName, tier, createdAt }`. If the credential is missing, invalid,
or expired it SHALL return `401 Unauthorized`.

#### Scenario: Valid session cookie returns current user
- **WHEN** a `GET /api/auth/me` request is made with a valid `helio_session` cookie
- **THEN** the system returns `200 OK` with `{ id, email, displayName, tier, createdAt }`
- **AND** the response SHALL NOT include the password hash

#### Scenario: Missing credentials returns 401
- **WHEN** a `GET /api/auth/me` request is made without a session cookie or `Authorization` header
- **THEN** the system returns `401 Unauthorized` with `{"error": "Unauthorized"}`

#### Scenario: Expired session cookie returns 401
- **WHEN** a `GET /api/auth/me` request is made with a `helio_session` cookie whose `expires_at` is in
  the past
- **THEN** the system returns `401 Unauthorized` with `{"error": "Unauthorized"}`
