## 1. Database Migration

- [x] 1.1 Create `V8__google_oauth.sql` adding `google_id TEXT` (nullable) and `avatar_url TEXT` (nullable) columns to `users`
- [x] 1.2 Add a partial unique index on `users(google_id) WHERE google_id IS NOT NULL`

## 2. Domain Model Updates

- [x] 2.1 Add `googleId: Option[String]` and `avatarUrl: Option[String]` fields to the `User` case class in `model.scala`
- [x] 2.2 Add `avatarUrl: Option[String]` to `UserResponse` and update `UserResponse.fromDomain` to include it

## 3. Configuration

- [x] 3.1 Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to `.env` (with placeholder values for dev)
- [x] 3.2 Load the three Google config values in `Main.scala` (or `HttpServer.scala`) at startup; fail fast with a descriptive error if any are missing or empty

## 4. Repository Layer

- [x] 4.1 Add `google_id` and `avatar_url` columns to `UserTable` in `UserRepository.scala`
- [x] 4.2 Update `UserRow` case class to include `googleId: Option[String]` and `avatarUrl: Option[String]`
- [x] 4.3 Update `rowToDomain` to map the new columns onto the `User` domain model
- [x] 4.4 Add `findByGoogleId(googleId: String): Future[Option[User]]` to `UserRepository`
- [x] 4.5 Add `upsertGoogleUser(googleId: String, email: String, displayName: Option[String], avatarUrl: Option[String]): Future[User]` — inserts on first login, updates `avatar_url` on subsequent logins
- [x] 4.6 Update `insert` to accept and store `googleId` and `avatarUrl` (defaulting to `None` for email/password registrations)

## 5. Google OAuth Routes

- [x] 5.1 Add `GET /api/auth/google` route to `AuthRoutes.scala` that builds and redirects to the Google consent URL
- [x] 5.2 Add `GET /api/auth/google/callback` route that reads the `code` or `error` query parameter
- [x] 5.3 Implement `exchangeCodeForToken(code: String): Future[String]` — POST to `https://oauth2.googleapis.com/token` using the Akka HTTP client, return the access token
- [x] 5.4 Implement `fetchGoogleProfile(accessToken: String): Future[GoogleProfile]` — GET `https://www.googleapis.com/oauth2/v3/userinfo`, parse `sub`, `email`, `name`, `picture`
- [x] 5.5 Wire the callback handler: exchange code → fetch profile → upsert user → create session → return `200 OK` with `AuthResponse`
- [x] 5.6 Handle `error` query parameter in callback: return `400 Bad Request` with `{ "error": "OAuth access denied" }` or `{ "error": "OAuth error: <value>" }`
- [x] 5.7 Handle token exchange failure (Google returns error): return `502 Bad Gateway` with `{ "error": "Failed to exchange authorization code" }`

## 6. JSON Protocols

- [x] 6.1 Add `GoogleProfile` case class and JSON reader in `JsonProtocols.scala` for the Google userinfo response
- [x] 6.2 Ensure `UserResponse` serialization includes `avatarUrl` field (update existing format if needed)

## 7. Tests

- [x] 7.1 Write a ScalaTest unit/integration test for the happy-path callback: mock Google HTTP calls, assert session is created and `AuthResponse` is returned
- [x] 7.2 Write a test for the access-denied callback error path (returns 400)
- [x] 7.3 Write a test for the token-exchange-failure path (returns 502)
- [x] 7.4 Write a test for a returning Google user: second login with same `google_id` returns existing user, no duplicate record
- [x] 7.5 Verify existing email/password auth tests still pass (no regression from `User` model changes)
