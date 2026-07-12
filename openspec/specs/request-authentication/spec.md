# request-authentication Specification

## Purpose
Credential requirements (session or PAT) that gate access to protected API routes.
## Requirements
### Requirement: Auth and health routes remain public
The `/api/auth/register`, `/api/auth/login`, and `/health` routes SHALL NOT require authentication.
`POST /api/auth/logout` requires a valid session (resolved the same way as other protected routes) to
identify which session to delete.

#### Scenario: Register is accessible without credentials
- **WHEN** a request is made to `POST /api/auth/register` without a session cookie or `Authorization`
  header
- **THEN** the request is processed normally (not rejected with 401)

#### Scenario: Login is accessible without credentials
- **WHEN** a request is made to `POST /api/auth/login` without a session cookie or `Authorization`
  header
- **THEN** the request is processed normally (not rejected with 401)

#### Scenario: Health check is accessible without credentials
- **WHEN** a request is made to `GET /health` without a session cookie or `Authorization` header
- **THEN** the server responds with `200 OK`

#### Scenario: Logout requires a valid session
- **WHEN** a request is made to `POST /api/auth/logout` without a valid session cookie
- **THEN** the server responds with `401 Unauthorized`

### Requirement: GET /api/auth/me returns the authenticated user
The system SHALL expose `GET /api/auth/me` that requires a valid session (cookie or PAT bearer, per
the "Protected routes require a valid session" requirement). On success it SHALL return `200 OK` with
the user object `{ id, email, displayName, createdAt }`. If the credential is missing, invalid, or
expired it SHALL return `401 Unauthorized`.

#### Scenario: Valid session cookie returns current user
- **WHEN** a `GET /api/auth/me` request is made with a valid `helio_session` cookie
- **THEN** the system returns `200 OK` with `{ id, email, displayName, createdAt }`
- **AND** the response SHALL NOT include the password hash

#### Scenario: Missing credentials returns 401
- **WHEN** a `GET /api/auth/me` request is made without a session cookie or `Authorization` header
- **THEN** the system returns `401 Unauthorized` with `{"error": "Unauthorized"}`

#### Scenario: Expired session cookie returns 401
- **WHEN** a `GET /api/auth/me` request is made with a `helio_session` cookie whose `expires_at` is in
  the past
- **THEN** the system returns `401 Unauthorized` with `{"error": "Unauthorized"}`

### Requirement: Protected routes require a valid session
All `/api/dashboards` and `/api/panels` routes SHALL require a valid session, resolved from either an
`HttpOnly` session cookie (`helio_session`, browser sessions) or an `Authorization: Bearer <token>`
header carrying a Personal Access Token (`helio_pat_...`, non-browser API clients). Raw session
tokens SHALL NOT be accepted via the `Authorization` header. The resolved credential MUST exist and
MUST NOT be expired/revoked. Requests that fail this check SHALL be rejected before the route handler
executes.

#### Scenario: Valid session cookie grants access
- **WHEN** a request includes a `helio_session` cookie whose value hashes to a row in `user_sessions`
  that is not expired
- **THEN** the route handler executes normally and returns the expected response

#### Scenario: Valid PAT bearer header grants access
- **WHEN** a request includes `Authorization: Bearer helio_pat_<valid-token>` where the token hash
  exists and is not revoked
- **THEN** the route handler executes normally and returns the expected response

#### Scenario: Raw session token via Authorization header is rejected
- **WHEN** a request includes `Authorization: Bearer <64-char-hex-session-token>` (not a
  `helio_pat_`-prefixed token) and no session cookie
- **THEN** the server responds with `401 Unauthorized`

#### Scenario: Missing credentials returns 401
- **WHEN** a request to a protected route has neither a `helio_session` cookie nor an `Authorization`
  header
- **THEN** the server responds with `401 Unauthorized`
- **THEN** the response body is `{"error": "Unauthorized"}`

#### Scenario: Unknown or expired session cookie returns 401
- **WHEN** a request includes a `helio_session` cookie whose value does not exist in `user_sessions`,
  or exists but `expires_at` is in the past
- **THEN** the server responds with `401 Unauthorized`
- **THEN** the response body is `{"error": "Unauthorized"}`

