# email-password-auth Specification

## Purpose
Email/password registration, login, and logout, with bcrypt-hashed credentials and session issuance.
## Requirements
### Requirement: User registration
The system SHALL expose `POST /api/auth/register` that accepts `email`, `password`, and optional
`displayName`. On success it SHALL create a user record with the password stored as a bcrypt hash
(cost factor ≥ 12), create a session, set the session as an `HttpOnly` cookie (`helio_session`) via
`Set-Cookie`, and return `201 Created` with `{ expiresAt, user }` — the response body SHALL NOT
include the session token. The response SHALL NOT include the password hash. The user object SHALL
include `avatarUrl` (which will be `null` for email/password registrations).

#### Scenario: Successful registration
- **WHEN** a `POST /api/auth/register` request is made with a valid email and a password of at least
  8 characters
- **THEN** the system returns `201 Created` with `{ expiresAt, user: { id, email, displayName,
  avatarUrl, createdAt } }` and a `Set-Cookie: helio_session=...; HttpOnly; ...` header
- **AND** the response body does not contain a `token` field
- **AND** the password is stored as a bcrypt hash, never in plaintext
- **AND** `avatarUrl` is `null`

#### Scenario: Duplicate email registration
- **WHEN** a `POST /api/auth/register` request is made with an email that already exists
- **THEN** the system returns `409 Conflict` with a descriptive error message

#### Scenario: Invalid email format
- **WHEN** a `POST /api/auth/register` request is made with a malformed email address
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Password too short
- **WHEN** a `POST /api/auth/register` request is made with a password shorter than 8 characters
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Missing required fields
- **WHEN** a `POST /api/auth/register` request is made with `email` or `password` absent
- **THEN** the system returns `400 Bad Request` with a descriptive error message

### Requirement: User login
The system SHALL expose `POST /api/auth/login` that accepts `email` and `password`. On success it
SHALL verify credentials, create a new session, set the session as an `HttpOnly` cookie
(`helio_session`) via `Set-Cookie`, and return `200 OK` with `{ expiresAt, user }` — the response body
SHALL NOT include the session token. Failed login attempts SHALL return `401 Unauthorized` with a
generic message that does not distinguish between unknown email and wrong password (no user
enumeration). The user object SHALL include `avatarUrl`.

#### Scenario: Successful login
- **WHEN** a `POST /api/auth/login` request is made with a valid email and correct password
- **THEN** the system returns `200 OK` with `{ expiresAt, user: { id, email, displayName, avatarUrl,
  createdAt } }` and a `Set-Cookie: helio_session=...; HttpOnly; ...` header
- **AND** the response body does not contain a `token` field

#### Scenario: Wrong password
- **WHEN** a `POST /api/auth/login` request is made with a known email but incorrect password
- **THEN** the system returns `401 Unauthorized` with the message `"Invalid email or password"`

#### Scenario: Unknown email
- **WHEN** a `POST /api/auth/login` request is made with an email that does not exist
- **THEN** the system returns `401 Unauthorized` with the message `"Invalid email or password"`
- **AND** the response SHALL be indistinguishable from the wrong-password response (same status, same
  body)

#### Scenario: Missing credentials
- **WHEN** a `POST /api/auth/login` request is made with `email` or `password` absent
- **THEN** the system returns `400 Bad Request` with a descriptive error message

### Requirement: User logout
The system SHALL expose `POST /api/auth/logout`, which requires a valid `helio_session` cookie
identifying the session to delete. On success it SHALL delete the session row, clear the cookie (an
expired `Set-Cookie: helio_session=; Max-Age=0; ...`), and return `204 No Content`. The session SHALL
be permanently invalid after logout.

#### Scenario: Successful logout
- **WHEN** a `POST /api/auth/logout` request is made with a valid `helio_session` cookie
- **THEN** the system returns `204 No Content` with a `Set-Cookie` header clearing `helio_session`
- **AND** the session token is deleted from `user_sessions`

#### Scenario: Logout with invalid or missing session cookie
- **WHEN** a `POST /api/auth/logout` request is made with no `helio_session` cookie or an
  unrecognised one
- **THEN** the system returns `401 Unauthorized`

### Requirement: Session token validity
Session tokens issued by register or login SHALL be valid for 30 days from issuance. The `expiresAt`
field in the response body SHALL reflect the exact expiry timestamp in ISO-8601 format, and the
`Set-Cookie` header's `Max-Age` SHALL match the same duration (2,592,000 seconds).

#### Scenario: Token expiry field in response
- **WHEN** a session token is issued (via register or login)
- **THEN** the response body SHALL include `expiresAt` as an ISO-8601 timestamp approximately 30 days
  in the future
- **AND** the `Set-Cookie` header's `Max-Age` attribute SHALL be `2592000`

### Requirement: Password storage security
The system SHALL store all passwords as bcrypt hashes with a cost factor of at least 12. Plaintext
passwords SHALL never appear in logs, responses, or DB rows.

#### Scenario: Password not returned in any response
- **WHEN** any auth endpoint returns a user object
- **THEN** the response body SHALL NOT contain a `password`, `passwordHash`, or `password_hash` field

