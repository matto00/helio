# email-password-auth Delta (add-totp-mfa)

## MODIFIED Requirements

### Requirement: User login
The system SHALL expose `POST /api/auth/login` that accepts `email` and `password`. On success for an
account without MFA enabled it SHALL verify credentials, create a new session, set the session as an
`HttpOnly` cookie (`helio_session`) via `Set-Cookie`, and return `200 OK` with `{ expiresAt, user }` —
the response body SHALL NOT include the session token. On success for an account with MFA enabled it
SHALL NOT create a session or set a cookie, and SHALL instead return `200 OK` with
`{ mfaRequired: true, challengeToken }` per the `mfa-login-gate` capability. Failed login attempts
SHALL return `401 Unauthorized` with a generic message that does not distinguish between unknown
email and wrong password (no user enumeration). The user object SHALL include `avatarUrl`.

#### Scenario: Successful login
- **WHEN** a `POST /api/auth/login` request is made with a valid email and correct password for an
  account without MFA enabled
- **THEN** the system returns `200 OK` with `{ expiresAt, user: { id, email, displayName, avatarUrl,
  createdAt } }` and a `Set-Cookie: helio_session=...; HttpOnly; ...` header
- **AND** the response body does not contain a `token` field

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
