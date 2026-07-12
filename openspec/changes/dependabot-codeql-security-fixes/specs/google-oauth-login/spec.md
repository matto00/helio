## MODIFIED Requirements

### Requirement: Google OAuth callback — successful login
The system SHALL expose `GET /api/auth/google/callback` as a public route that handles the
authorization code returned by Google. On receiving a valid `code` query parameter the system SHALL
exchange it for an access token using Google's token endpoint, fetch the user profile from Google's
userinfo endpoint, upsert the user record (creating on first login, matching by `google_id` on
subsequent logins), create a new `user_sessions` row, set the session as an `HttpOnly` cookie
(`helio_session`) via `Set-Cookie`, and return `200 OK` with `{ expiresAt, user }` — the response body
SHALL NOT include the session token.

#### Scenario: New user first-time Google login
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received and no user with the returned
  `google_id` exists
- **THEN** the system exchanges the code for an access token, fetches the Google profile, creates a
  new user record with `google_id` and `avatar_url` populated, creates a session, sets a
  `Set-Cookie: helio_session=...; HttpOnly; ...` header, and returns `200 OK` with `{ expiresAt, user:
  { id, email, displayName, avatarUrl, createdAt } }`
- **AND** the response body does not contain a `token` field

#### Scenario: Returning user Google login
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received and a user with the returned
  `google_id` already exists
- **THEN** the system creates a new session for the existing user, sets the `helio_session` cookie,
  and returns `200 OK` with `{ expiresAt, user: { id, email, displayName, avatarUrl, createdAt } }`
- **AND** no duplicate user record is created

#### Scenario: Google profile includes avatar URL
- **WHEN** Google's userinfo response contains a `picture` field
- **THEN** the user record's `avatar_url` is set to that value and returned in the `user` object as
  `avatarUrl`
