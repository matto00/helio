# google-oauth-login Specification

## Purpose
Google OAuth2 login flow: consent redirect, callback code exchange, and user upsert/session issuance.

## Requirements

### Requirement: Google OAuth consent redirect
The system SHALL expose `GET /api/auth/google` as a public route that redirects the browser to the Google OAuth2 consent screen. The redirect URL SHALL include `client_id`, `redirect_uri`, `response_type=code`, and `scope=openid email profile` query parameters. This route SHALL NOT require an `Authorization` header.

#### Scenario: Redirect to Google consent screen
- **WHEN** a `GET /api/auth/google` request is made without any credentials
- **THEN** the system responds with `302 Found` and a `Location` header pointing to `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code`, `scope=openid email profile`, `client_id`, and `redirect_uri` query parameters

### Requirement: Google OAuth callback — successful login
The system SHALL expose `GET /api/auth/google/callback` as a public route that handles the
authorization code returned by Google. On receiving a valid `code` query parameter the system SHALL
exchange it for an access token using Google's token endpoint, fetch the user profile from Google's
userinfo endpoint, upsert the user record (creating on first login, matching by `google_id` on
subsequent logins), and assign or promote the user's tier per the owner-email allowlist (a newly
created user gets `owner` on a match, else `free`; a returning user with a matching email whose stored
tier is not already `owner` is promoted and the promotion persisted). For an account without MFA
enabled it SHALL then create a new `user_sessions` row, set the session as an `HttpOnly` cookie
(`helio_session`) via `Set-Cookie`, and return `200 OK` with `{ expiresAt, user }` — the response body
SHALL NOT include the session token. For an account with MFA enabled it SHALL NOT create a session or
set a cookie, and SHALL instead return `200 OK` with `{ mfaRequired: true, challengeToken }` per the
`mfa-login-gate` capability. The user object SHALL include `tier`.

#### Scenario: New user first-time Google login
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received and no user with the returned
  `google_id` exists
- **THEN** the system exchanges the code for an access token, fetches the Google profile, creates a
  new user record with `google_id` and `avatar_url` populated and tier assigned per the allowlist,
  creates a session, sets a `Set-Cookie: helio_session=...; HttpOnly; ...` header, and returns
  `200 OK` with `{ expiresAt, user: { id, email, displayName, avatarUrl, tier, createdAt } }`
- **AND** the response body does not contain a `token` field

#### Scenario: Returning user Google login
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received and a user with the returned
  `google_id` already exists and does not have MFA enabled
- **THEN** the system applies the owner-email allowlist promotion, creates a new session for the
  existing user, sets the `helio_session` cookie, and returns `200 OK` with `{ expiresAt, user: { id,
  email, displayName, avatarUrl, tier, createdAt } }`
- **AND** no duplicate user record is created

#### Scenario: Returning user with MFA enabled
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received for a user with MFA enabled
- **THEN** the system returns `200 OK` with `{ mfaRequired: true, challengeToken }`, no `Set-Cookie`
  header, and no `user` object

#### Scenario: Google profile includes avatar URL
- **WHEN** Google's userinfo response contains a `picture` field
- **THEN** the user record's `avatar_url` is set to that value and returned in the `user` object as
  `avatarUrl`

### Requirement: Google OAuth callback — user denied access
The system SHALL handle the case where the user denies the OAuth consent screen. Google redirects back to the callback URL with an `error=access_denied` query parameter instead of `code`. The system SHALL return `400 Bad Request` with `{ "error": "OAuth access denied" }`.

#### Scenario: User denies consent
- **WHEN** `GET /api/auth/google/callback?error=access_denied` is received
- **THEN** the system returns `400 Bad Request` with `{ "error": "OAuth access denied" }`

#### Scenario: Other OAuth error parameter
- **WHEN** `GET /api/auth/google/callback?error=<any-error-value>` is received
- **THEN** the system returns `400 Bad Request` with `{ "error": "OAuth error: <error-value>" }`

### Requirement: Google OAuth callback — invalid or expired code
If the authorization code exchange with Google fails (e.g., the code has expired or is invalid), the system SHALL return `502 Bad Gateway` with `{ "error": "Failed to exchange authorization code" }`.

#### Scenario: Expired authorization code
- **WHEN** `GET /api/auth/google/callback?code=<expired-or-invalid-code>` is received and Google's token endpoint returns an error
- **THEN** the system returns `502 Bad Gateway` with `{ "error": "Failed to exchange authorization code" }`

### Requirement: User record stores Google identity fields
The `users` table SHALL include a `google_id` column (TEXT, nullable, unique among non-null values) and an `avatar_url` column (TEXT, nullable). These SHALL be populated from the Google profile on first login and updated on subsequent logins if changed.

#### Scenario: google_id uniqueness
- **WHEN** two concurrent or sequential login attempts for the same Google account occur
- **THEN** only one user record exists for that `google_id` after both complete

#### Scenario: avatar_url updated on login
- **WHEN** a returning Google user logs in and their Google profile picture URL has changed
- **THEN** the stored `avatar_url` is updated to the new value

### Requirement: Google OAuth routes are public
`GET /api/auth/google` and `GET /api/auth/google/callback` SHALL NOT require an `Authorization: Bearer` token. They SHALL be treated as public routes alongside `POST /api/auth/register` and `POST /api/auth/login`.

#### Scenario: Google routes accessible without token
- **WHEN** a request is made to `GET /api/auth/google` or `GET /api/auth/google/callback` without an `Authorization` header
- **THEN** the request is processed normally (not rejected with 401)

### Requirement: Google OAuth configuration
The system SHALL read `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` from environment variables (via `.env`). If any of these are missing or empty at startup, the system SHALL fail to start with a clear configuration error.

#### Scenario: Missing Google credentials at startup
- **WHEN** the server starts without `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REDIRECT_URI` defined
- **THEN** the application fails to start and logs a descriptive error message naming the missing variable(s)

### Requirement: Google OAuth callback — unexpected internal failure

The system SHALL return a generic `500 Internal Server Error` body when the OAuth callback fails unexpectedly. When the failure is not a denied consent, an invalid CSRF state, a missing code, or a recognized upstream token/userinfo error (i.e. an unexpected internal exception), the system SHALL respond with `{ "error": "Internal server error" }` and SHALL NOT include the raw exception message or any internal detail in the client response. The full exception, including its stack trace, SHALL be logged server-side for diagnosis.

#### Scenario: Unexpected exception during code exchange

- **WHEN** `GET /api/auth/google/callback?code=<code>` is received with a valid CSRF
  state and processing throws an unexpected exception that is not a recognized upstream
  OAuth error
- **THEN** the system returns `500 Internal Server Error` with
  `{ "error": "Internal server error" }`
- **AND** the response body contains no raw exception message or internal detail
- **AND** the full exception and stack trace are logged server-side

### Requirement: Google OAuth CSRF state round trip is process-independent

The system SHALL issue a CSRF state value on `GET /api/auth/google`, include it as the `state` query
parameter on the redirect to Google's consent screen, and require a matching, unconsumed, unexpired
state on `GET /api/auth/google/callback`. The round trip SHALL succeed when the consent redirect and
the callback are served by **different processes**, and when the process that issued the state has
terminated before the callback arrives.

The system SHALL reject a callback whose `state` parameter is missing, was never issued, has expired,
or has already been consumed, with `400 Bad Request` and `{ "message": "Invalid or missing OAuth state
parameter" }`. This rejection SHALL occur before the authorization code is exchanged with Google.

*Correction, recorded deliberately (evaluation-1.md CR3, escalated to this spec file on review):*
this requirement originally read `{ "error": ... }` in every occurrence below. That was wrong when
written, not a regression from this change — `ErrorResponse` (`ResourceProtocol.scala`) has
serialized its single field as `message`, never `error`, since long before this ticket existed
(HEL-236, predates this change by hundreds of commits). The route code was always correct; only
this planning artifact was wrong. Verified live against the running server during delivery
(`GoogleOAuthRoutesSpec`'s route-level tests assert the exact body with `shouldBe`).

#### Scenario: Consent redirect issues a state parameter

- **WHEN** a `GET /api/auth/google` request is made
- **THEN** the system responds with `302 Found` whose `Location` includes a non-empty `state` query
  parameter
- **AND** that state validates successfully on a subsequent callback

#### Scenario: Callback served by a different process than the initiation succeeds

- **WHEN** a state is issued by one serving process
- **AND** `GET /api/auth/google/callback?code=<valid-code>&state=<that-state>` is handled by a
  different serving process that shares no in-memory state with the issuing process
- **THEN** the state check passes and the callback proceeds to the authorization code exchange

#### Scenario: Missing state is rejected

- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received with no `state` parameter
- **THEN** the system returns `400 Bad Request` with `{ "message": "Invalid or missing OAuth state parameter" }`
- **AND** no authorization code exchange with Google is attempted

#### Scenario: Forged state is rejected

- **WHEN** `GET /api/auth/google/callback?code=<valid-code>&state=<never-issued-value>` is received
- **THEN** the system returns `400 Bad Request` with `{ "message": "Invalid or missing OAuth state parameter" }`
- **AND** no authorization code exchange with Google is attempted

#### Scenario: Expired state is rejected

- **WHEN** `GET /api/auth/google/callback?code=<valid-code>&state=<state issued more than 300 seconds earlier>`
  is received
- **THEN** the system returns `400 Bad Request` with `{ "message": "Invalid or missing OAuth state parameter" }`

#### Scenario: Replayed state is rejected

- **WHEN** a callback has already completed successfully using a given state
- **AND** a second callback presents the same state value
- **THEN** the second request returns `400 Bad Request` with
  `{ "message": "Invalid or missing OAuth state parameter" }`
