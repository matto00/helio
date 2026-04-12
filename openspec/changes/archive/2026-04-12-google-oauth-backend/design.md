## Context

Helio has an existing email/password auth system: `AuthRoutes.scala` handles register/login/logout, `UserRepository` manages the `users` and `user_sessions` tables, and `AuthDirectives` validates Bearer tokens for protected routes. The `users` table currently stores `email`, `password_hash`, `display_name`, and `created_at`.

Google OAuth2 uses a redirect-based flow rather than a credential POST. The backend must redirect to Google, receive an authorization code on callback, exchange it server-side for an access token, fetch the user profile, and then create (or match) a Helio user record.

## Goals / Non-Goals

**Goals:**
- Add `GET /api/auth/google` and `GET /api/auth/google/callback` endpoints to `AuthRoutes`
- Upsert users by `google_id`; new users are auto-registered; returning users are matched exactly by `google_id`
- Issue a Helio session token using the same `user_sessions` mechanism already in place
- Store `google_id` and `avatar_url` alongside the existing user columns
- Return the session token as a JSON body (same `AuthResponse` shape already used by login/register)
- Add the two new Google routes to the existing auth public whitelist in `ApiRoutes`
- Handle callback error cases (user denied, invalid code) with a clear error response

**Non-Goals:**
- Frontend OAuth UI or redirect flow (HEL-38 scope)
- Linking Google to an existing email/password account post-registration
- Using an OAuth library/framework — plain Akka HTTP client calls are sufficient and keep the dependency footprint small
- PKCE or state parameter CSRF protection in this iteration (noted as a risk)

## Decisions

### Decision: No new OAuth library

**Choice**: Use the existing Akka HTTP client (`Http().singleRequest`) for the token exchange and userinfo fetch rather than adding a dedicated OAuth2 library.

**Rationale**: The server-side Authorization Code flow requires exactly two HTTP calls (token exchange + profile fetch). Both are simple POST/GET calls with JSON responses. Adding a library (e.g., `akka-http-oauth2-provider`, `play-silhouette`, or `sttp`) would introduce a transitive dependency graph for very little gain. Akka HTTP is already on the classpath.

**Alternative considered**: `sttp` with an OAuth2 extension — rejected because it would be a new library (requires escalation per scope) and the complexity doesn't justify it.

### Decision: Upsert-by-google-id, not by email

**Choice**: Match returning users by `google_id` column, not by email address.

**Rationale**: Google accounts can change their primary email. Matching on `google_id` (a stable opaque identifier from Google) prevents duplicate user records and correctly handles email changes. This is explicitly required by the ticket.

**Implementation**: `UserRepository.findByGoogleId(googleId: String)` and `upsertGoogleUser(...)` which finds-or-creates atomically enough for our single-instance use case.

### Decision: Session token returned as JSON body

**Choice**: Return `{ token, expiresAt, user }` in the JSON body — same `AuthResponse` shape as login/register.

**Rationale**: Consistency with the existing auth surface. The frontend (HEL-38) can store the token in memory or localStorage. An httpOnly cookie is an alternative but would require CORS and same-site config changes not yet in scope.

### Decision: Extend `AuthRoutes` rather than create a new file

**Choice**: Add the two Google routes to the existing `AuthRoutes.scala`.

**Rationale**: They are logically part of the auth surface and share the same session-creation logic (`generateToken`, `UserRepository`). A separate file would be premature when the auth routes file is still small.

### Decision: DB migration is additive

**Choice**: Add `google_id` (TEXT UNIQUE, nullable) and `avatar_url` (TEXT, nullable) to `users` via a new Flyway migration `V8__google_oauth.sql`.

**Rationale**: Existing email/password users will have `NULL` in both columns. The unique constraint on `google_id` uses a partial index (`WHERE google_id IS NOT NULL`) to allow multiple NULL values without violating uniqueness.

### Decision: `email` column becomes nullable for Google-only users

**Choice**: Google users may not have a verified email exposed (rare but possible). Make `email` nullable (change from `NOT NULL`) or use an empty placeholder.

**Rationale**: Google's `userinfo` response always includes `email` when the `email` scope is requested, and we will request it. We will store it but not enforce it as a login key for Google users. To avoid a migration that changes NOT NULL on an existing column, we'll store the Google email as-is and allow it to be NULL via a separate migration step — or store a placeholder. **Self-approved decision**: store the Google email when present; leave `email` as NOT NULL and use a sentinel placeholder (`google:<google_id>@helio.invalid`) if absent. This avoids a risky schema change on a production column.

## Risks / Trade-offs

- **No CSRF state parameter** → The OAuth callback does not validate a `state` parameter, leaving a small CSRF window during the redirect flow. Mitigation: acceptable for an initial implementation targeting a single-tenant dev setup; add state validation in a follow-up.
- **`email` uniqueness conflict** → If a user previously registered with email/password using the same email as their Google account, `findByGoogleId` will not find them and `insert` will fail on the unique email constraint. Mitigation: return a clear 409-style redirect error; account linking is out of scope for this ticket.
- **Google API downtime** → If Google's token or userinfo endpoint is slow/unavailable, the callback will time out. Mitigation: Akka HTTP client has a configurable timeout; return a 502 or redirect with an error query param on failure.

## Migration Plan

1. Add `V8__google_oauth.sql` Flyway migration (additive: new nullable columns + partial unique index)
2. Add config variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` to `.env` and `Main.scala` config loading
3. Extend `UserRepository` with `findByGoogleId` and `upsertGoogleUser`
4. Add the two Google routes to `AuthRoutes`
5. Register the new routes in `ApiRoutes` (they are under `/api/auth` which is already public — no auth-whitelist change needed)
6. Write ScalaTest integration tests for the callback handler (happy path + error cases)

Rollback: the Flyway migration is additive; rollback simply means not calling the new routes. Columns can be dropped with a subsequent migration if needed.

## Open Questions

- None — all decisions self-approved per ticket scope.
