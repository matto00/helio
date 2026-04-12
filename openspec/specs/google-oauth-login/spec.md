## ADDED Requirements

### Requirement: Google OAuth consent redirect
The system SHALL expose `GET /api/auth/google` as a public route that redirects the browser to the Google OAuth2 consent screen. The redirect URL SHALL include `client_id`, `redirect_uri`, `response_type=code`, and `scope=openid email profile` query parameters. This route SHALL NOT require an `Authorization` header.

#### Scenario: Redirect to Google consent screen
- **WHEN** a `GET /api/auth/google` request is made without any credentials
- **THEN** the system responds with `302 Found` and a `Location` header pointing to `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code`, `scope=openid email profile`, `client_id`, and `redirect_uri` query parameters

### Requirement: Google OAuth callback — successful login
The system SHALL expose `GET /api/auth/google/callback` as a public route that handles the authorization code returned by Google. On receiving a valid `code` query parameter the system SHALL exchange it for an access token using Google's token endpoint, fetch the user profile from Google's userinfo endpoint, upsert the user record (creating on first login, matching by `google_id` on subsequent logins), create a new `user_sessions` row, and return `200 OK` with `{ token, expiresAt, user }`.

#### Scenario: New user first-time Google login
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received and no user with the returned `google_id` exists
- **THEN** the system exchanges the code for an access token, fetches the Google profile, creates a new user record with `google_id` and `avatar_url` populated, creates a session, and returns `200 OK` with `{ token, expiresAt, user: { id, email, displayName, avatarUrl, createdAt } }`

#### Scenario: Returning user Google login
- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received and a user with the returned `google_id` already exists
- **THEN** the system creates a new session for the existing user and returns `200 OK` with `{ token, expiresAt, user: { id, email, displayName, avatarUrl, createdAt } }`
- **AND** no duplicate user record is created

#### Scenario: Google profile includes avatar URL
- **WHEN** Google's userinfo response contains a `picture` field
- **THEN** the user record's `avatar_url` is set to that value and returned in the `user` object as `avatarUrl`

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
