# google-oauth-login Delta Spec

## MODIFIED Requirements

### Requirement: Google OAuth callback — successful login
The system SHALL expose `GET /api/auth/google/callback` as a public route that handles the
authorization code returned by Google. On receiving a valid `code` query parameter the system SHALL
exchange it for an access token using Google's token endpoint, fetch the user profile from Google's
userinfo endpoint, upsert the user record (creating on first login, matching by `google_id` on
subsequent logins), assign or promote the user's tier per the owner-email allowlist (a newly created
user gets `owner` on a match, else `free`; a returning user with a matching email whose stored tier is
not already `owner` is promoted and the promotion persisted), create a new `user_sessions` row, set
the session as an `HttpOnly` cookie (`helio_session`) via `Set-Cookie`, and return `200 OK` with
`{ expiresAt, user }` — the response body SHALL NOT include the session token. The user object SHALL
include `tier`.

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
  `google_id` already exists
- **THEN** the system applies the owner-email allowlist promotion, creates a new session for the
  existing user, sets the `helio_session` cookie, and returns `200 OK` with `{ expiresAt, user: { id,
  email, displayName, avatarUrl, tier, createdAt } }`
- **AND** no duplicate user record is created

#### Scenario: Google profile includes avatar URL
- **WHEN** Google's userinfo response contains a `picture` field
- **THEN** the user record's `avatar_url` is set to that value and returned in the `user` object as
  `avatarUrl`
