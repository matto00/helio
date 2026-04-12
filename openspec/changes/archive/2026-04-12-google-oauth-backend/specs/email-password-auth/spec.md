## MODIFIED Requirements

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
