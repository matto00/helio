# mfa-login-gate Specification

## Purpose
The backend session-establishment gate: when an account has MFA enabled, primary auth success
(password or Google OAuth) yields a short-lived challenge instead of a session; a public verify
endpoint exchanges the challenge plus a TOTP or backup code for the session.

## ADDED Requirements

### Requirement: Pending-login challenge model
The database SHALL have a `mfa_login_challenges` table (`id` UUID PK default gen_random_uuid();
`user_id` UUID NOT NULL, FK → users.id ON DELETE CASCADE; `token_hash` TEXT UNIQUE NOT NULL;
`attempts` INT NOT NULL DEFAULT 0; `created_at` TIMESTAMPTZ NOT NULL DEFAULT now(); `expires_at`
TIMESTAMPTZ NOT NULL), without row-level security. Challenge tokens SHALL be generated from a
cryptographically secure source and stored only as SHA-256 hashes. Challenges SHALL expire 5 minutes
after creation and SHALL be single-use (deleted on successful verification).

#### Scenario: Migration applies cleanly
- **WHEN** Flyway runs migrations on a database at V87
- **THEN** `mfa_login_challenges` is created with the columns and constraints above

### Requirement: MFA-enabled login yields a challenge, not a session
The system SHALL NOT create a `user_sessions` row and SHALL NOT set a `helio_session` cookie when a
user with MFA enabled completes primary authentication on either path — password
(`POST /api/auth/login`) or Google OAuth (`GET /api/auth/google/callback`). Instead it SHALL create a
`mfa_login_challenges` row and return `200 OK` with `{ mfaRequired: true, challengeToken }`. The
response SHALL NOT include the user object or any profile data. Users without MFA enabled SHALL be
entirely unaffected on both paths.

#### Scenario: Password login with MFA enabled
- **WHEN** `POST /api/auth/login` succeeds for an MFA-enabled account
- **THEN** the response is `200 OK` with `{ mfaRequired: true, challengeToken: <token> }`
- **AND** no `Set-Cookie` header is present and no `user_sessions` row was created
- **AND** the body contains no `user` object

#### Scenario: OAuth callback with MFA enabled
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` succeeds for an MFA-enabled account
- **THEN** the response is `200 OK` with `{ mfaRequired: true, challengeToken: <token> }`, no
  `Set-Cookie` header, and no `user` object

#### Scenario: Login without MFA is unchanged
- **WHEN** `POST /api/auth/login` succeeds for an account without MFA
- **THEN** the response and `Set-Cookie` behavior are exactly as specified in `email-password-auth`

### Requirement: MFA verification endpoint
The system SHALL expose `POST /api/auth/mfa/verify` as a public route accepting
`{ challengeToken, code }`. When the challenge token matches an unexpired challenge and the code is
either (a) a valid current TOTP code for the user's secret or (b) an unused backup code, the system
SHALL delete the challenge, create a `user_sessions` row, set the `helio_session` cookie, and return
`200 OK` with the standard `{ expiresAt, user }` login response (no token in the body). A used backup
code SHALL be marked used in the same operation and never accepted again.

#### Scenario: Verifying with a valid TOTP code
- **WHEN** `POST /api/auth/mfa/verify` is called with a live challenge token and a current TOTP code
- **THEN** the response is `200 OK` with `{ expiresAt, user }` and a
  `Set-Cookie: helio_session=...; HttpOnly; ...` header
- **AND** the challenge row is deleted

#### Scenario: Verifying with a backup code
- **WHEN** `POST /api/auth/mfa/verify` is called with a live challenge token and an unused backup code
- **THEN** a session is established as above and the backup code's `used_at` is set

#### Scenario: A backup code is single-use
- **WHEN** a previously used backup code is submitted with a fresh valid challenge
- **THEN** the response is `401 Unauthorized` and no session is created

### Requirement: Verification failure modes are uniform and bounded
An invalid code, an unknown or expired challenge token, or a challenge past its attempt limit SHALL
all yield the same generic `401 Unauthorized` (no oracle distinguishing them). Each failed
verification attempt against a live challenge SHALL increment its `attempts` counter; once
`attempts` reaches 5 the challenge SHALL be rejected even with a correct code, requiring the user to
restart primary authentication.

#### Scenario: Wrong code increments attempts
- **WHEN** `POST /api/auth/mfa/verify` is called with a live challenge and a wrong code
- **THEN** the response is `401 Unauthorized` and the challenge's `attempts` is incremented

#### Scenario: Attempt cap exhausts the challenge
- **WHEN** a challenge has accumulated 5 failed attempts and a subsequent request carries the correct code
- **THEN** the response is `401 Unauthorized` and no session is created

#### Scenario: Expired challenge
- **WHEN** `POST /api/auth/mfa/verify` is called with a challenge token older than 5 minutes
- **THEN** the response is `401 Unauthorized` and no session is created

### Requirement: TOTP codes cannot be replayed
The system SHALL accept TOTP codes for the current 30-second step and its immediate neighbors
(±1 step) and SHALL persist the step of every accepted code in `user_mfa.last_used_step`, rejecting
any code whose step is not strictly greater than the stored value. This applies wherever a TOTP code
is verified (login verification, enrollment confirmation, re-authentication for disable/regenerate).

#### Scenario: Same code submitted twice
- **WHEN** a TOTP code is accepted once and the identical code is submitted again within its window
  with a fresh valid challenge
- **THEN** the second submission returns `401 Unauthorized`

#### Scenario: Adjacent-step skew is tolerated
- **WHEN** a client's authenticator is up to 30 seconds behind or ahead of the server
- **THEN** its current code is still accepted
