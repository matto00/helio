## MODIFIED Requirements

### Requirement: User registration
The system SHALL expose `POST /api/auth/register` that accepts `email`, `password`, and optional
`displayName`. The email SHALL be trimmed and lowercased before validation, lookup and storage. On
success it SHALL create a user record with the password stored as a bcrypt hash (cost factor ≥ 12),
assign the user `tier = free` (registration never assigns `owner`, even for an allowlisted email),
create a session, set the session as an `HttpOnly` cookie (`helio_session`) via `Set-Cookie`, and
return `201 Created` with `{ expiresAt, user }` — the response body SHALL NOT include the session
token. The response SHALL NOT include the password hash. The user object SHALL include `avatarUrl`
(which will be `null` for email/password registrations) and `tier`.

#### Scenario: Successful registration
- **WHEN** a `POST /api/auth/register` request is made with a valid email and a password of at least
  8 characters
- **THEN** the system returns `201 Created` with `{ expiresAt, user: { id, email, displayName,
  avatarUrl, tier, createdAt } }` and a `Set-Cookie: helio_session=...; HttpOnly; ...` header
- **AND** the response body does not contain a `token` field
- **AND** the password is stored as a bcrypt hash, never in plaintext
- **AND** `avatarUrl` is `null`
- **AND** `tier` is `free`, whether or not the email is on the owner allowlist

#### Scenario: Duplicate email registration
- **WHEN** a `POST /api/auth/register` request is made with an email that already exists, in any
  letter case or with surrounding whitespace
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
The system SHALL expose `POST /api/auth/login` that accepts `email` and `password`. The email SHALL be
trimmed and lowercased before lookup. On success it SHALL verify credentials; it SHALL NOT change the
account's tier (password login never promotes to `owner`). For an account without MFA enabled it
SHALL then create a new session, set the session as an `HttpOnly` cookie (`helio_session`) via
`Set-Cookie`, and return `200 OK` with `{ expiresAt, user }` — the response body SHALL NOT include the
session token. For an account with MFA enabled it SHALL NOT create a session or set a cookie, and
SHALL instead return `200 OK` with `{ mfaRequired: true, challengeToken }` per the `mfa-login-gate`
capability. Failed login attempts SHALL return `401 Unauthorized` with a generic message that does not
distinguish between unknown email and wrong password (no user enumeration). The user object SHALL
include `avatarUrl` and `tier`.

#### Scenario: Successful login
- **WHEN** a `POST /api/auth/login` request is made with a valid email and correct password for an
  account without MFA enabled
- **THEN** the system returns `200 OK` with `{ expiresAt, user: { id, email, displayName, avatarUrl,
  tier, createdAt } }` and a `Set-Cookie: helio_session=...; HttpOnly; ...` header
- **AND** the response body does not contain a `token` field

#### Scenario: Login email is case-insensitive
- **WHEN** a `POST /api/auth/login` request is made with a differently-cased form of a registered
  email and the correct password
- **THEN** the login succeeds for that account

#### Scenario: Successful primary auth with MFA enabled
- **WHEN** a `POST /api/auth/login` request is made with valid credentials for an account with MFA
  enabled
- **THEN** the system returns `200 OK` with `{ mfaRequired: true, challengeToken }`, no `Set-Cookie`
  header, and no `user` object

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
