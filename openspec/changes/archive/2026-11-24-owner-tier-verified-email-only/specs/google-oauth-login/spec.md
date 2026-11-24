## MODIFIED Requirements

### Requirement: Google OAuth callback — successful login
The system SHALL expose `GET /api/auth/google/callback` as a public route that handles the
authorization code returned by Google. On receiving a valid `code` query parameter the system SHALL
exchange it for an access token using Google's token endpoint, fetch the user profile from Google's
userinfo endpoint (including its `email_verified` flag; a missing or non-`true` value SHALL be treated
as unverified and SHALL NOT fail the request), trim and lowercase the profile email, upsert the user
record (creating on first login, matching by `google_id` on subsequent logins), and assign or promote
the user's tier per the owner-email allowlist ONLY when the email is verified (a newly created user
gets `owner` on a verified match, else `free`; a returning user with a verified, matching email whose
stored tier is not already `owner` is promoted and the promotion persisted; an unverified email never
grants or promotes `owner`, and no user is ever demoted). For an account without MFA enabled it SHALL
then create a new `user_sessions` row, set the session as an `HttpOnly` cookie (`helio_session`) via
`Set-Cookie`, and return `200 OK` with `{ expiresAt, user }` — the response body SHALL NOT include the
session token. For an account with MFA enabled it SHALL NOT create a session or set a cookie, and
SHALL instead return `200 OK` with `{ mfaRequired: true, challengeToken }` per the `mfa-login-gate`
capability. The user object SHALL include `tier`.

#### Scenario: New user first-time Google login
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received and no user with the returned
  `google_id` exists
- **THEN** the system exchanges the code for an access token, fetches the Google profile, creates a
  new user record with `google_id` and `avatar_url` populated and tier assigned per the allowlist and
  `email_verified`, creates a session, sets a `Set-Cookie: helio_session=...; HttpOnly; ...` header,
  and returns `200 OK` with `{ expiresAt, user: { id, email, displayName, avatarUrl, tier, createdAt } }`
- **AND** the response body does not contain a `token` field

#### Scenario: Unverified allowlisted email is not granted owner
- **WHEN** the Google profile's email is on the owner allowlist and `email_verified` is `false` or
  absent
- **THEN** the callback completes as for any other user and the user's tier is not `owner` (unless it
  already was)

#### Scenario: Returning user Google login
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received and a user with the returned
  `google_id` already exists and does not have MFA enabled
- **THEN** the system applies the verified-only owner-email allowlist promotion, creates a new session
  for the existing user, sets the `helio_session` cookie, and returns `200 OK` with `{ expiresAt,
  user: { id, email, displayName, avatarUrl, tier, createdAt } }`
- **AND** no duplicate user record is created

#### Scenario: Returning user with MFA enabled
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received for a user with MFA enabled
- **THEN** the system returns `200 OK` with `{ mfaRequired: true, challengeToken }`, no `Set-Cookie`
  header, and no `user` object

#### Scenario: Google profile includes avatar URL
- **WHEN** Google's userinfo response contains a `picture` field
- **THEN** the user record's `avatar_url` is set to that value and returned in the `user` object as
  `avatarUrl`
