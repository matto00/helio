## ADDED Requirements

### Requirement: User registration
The system SHALL expose `POST /api/auth/register` that accepts `email`, `password`, and optional `displayName`. On success it SHALL create a user record with the password stored as a bcrypt hash (cost factor ≥ 12), create a session, and return `201 Created` with a session token and user object. The response SHALL NOT include the password hash. The user object SHALL include `avatarUrl` (which will be `null` for email/password registrations).

#### Scenario: Successful registration
- **WHEN** a `POST /api/auth/register` request is made with a valid email and a password of at least 8 characters
- **THEN** the system returns `201 Created` with `{ token, expiresAt, user: { id, email, displayName, avatarUrl, createdAt } }`
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
The system SHALL expose `POST /api/auth/login` that accepts `email` and `password`. On success it SHALL verify credentials, create a new session, and return `200 OK` with a session token and user object. Failed login attempts SHALL return `401 Unauthorized` with a generic message that does not distinguish between unknown email and wrong password (no user enumeration). The user object SHALL include `avatarUrl`.

#### Scenario: Successful login
- **WHEN** a `POST /api/auth/login` request is made with a valid email and correct password
- **THEN** the system returns `200 OK` with `{ token, expiresAt, user: { id, email, displayName, avatarUrl, createdAt } }`

#### Scenario: Wrong password
- **WHEN** a `POST /api/auth/login` request is made with a known email but incorrect password
- **THEN** the system returns `401 Unauthorized` with the message `"Invalid email or password"`

#### Scenario: Unknown email
- **WHEN** a `POST /api/auth/login` request is made with an email that does not exist
- **THEN** the system returns `401 Unauthorized` with the message `"Invalid email or password"`
- **AND** the response SHALL be indistinguishable from the wrong-password response (same status, same body)

#### Scenario: Missing credentials
- **WHEN** a `POST /api/auth/login` request is made with `email` or `password` absent
- **THEN** the system returns `400 Bad Request` with a descriptive error message

### Requirement: User logout
The system SHALL expose `POST /api/auth/logout` that accepts an `Authorization: Bearer <token>` header. On success it SHALL delete the session row and return `204 No Content`. The session SHALL be permanently invalid after logout.

#### Scenario: Successful logout
- **WHEN** a `POST /api/auth/logout` request is made with a valid bearer token
- **THEN** the system returns `204 No Content`
- **AND** the session token is deleted from `user_sessions`

#### Scenario: Logout with invalid or missing token
- **WHEN** a `POST /api/auth/logout` request is made with no `Authorization` header or an unrecognised token
- **THEN** the system returns `401 Unauthorized`

### Requirement: Session token validity
Session tokens issued by register or login SHALL be valid for 30 days from issuance. The `expiresAt` field in the response SHALL reflect the exact expiry timestamp in ISO-8601 format.

#### Scenario: Token expiry field in response
- **WHEN** a session token is issued (via register or login)
- **THEN** the response SHALL include `expiresAt` as an ISO-8601 timestamp approximately 30 days in the future

### Requirement: Password storage security
The system SHALL store all passwords as bcrypt hashes with a cost factor of at least 12. Plaintext passwords SHALL never appear in logs, responses, or DB rows.

#### Scenario: Password not returned in any response
- **WHEN** any auth endpoint returns a user object
- **THEN** the response body SHALL NOT contain a `password`, `passwordHash`, or `password_hash` field
