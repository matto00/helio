## Context

Helio's backend has five Flyway migrations (V1–V5) establishing `dashboards`, `panels`, `data_sources`, and `data_types`. All resources hardcode `createdBy = "system"`. There is no concept of a user identity yet.

This change introduces the `users` and `user_sessions` tables and three auth endpoints. It is intentionally scoped to auth mechanics only — route protection comes in HEL-34.

## Goals / Non-Goals

**Goals:**
- `POST /api/auth/register` — create a user, store bcrypt hash (cost ≥ 12), return session token
- `POST /api/auth/login` — verify credentials, return session token; resist user enumeration
- `POST /api/auth/logout` — delete the session row server-side (requires `Authorization: Bearer <token>`)
- DB-backed session tokens stored in `user_sessions`; sessions expire after 30 days
- Input validation: email regex + password minimum 8 chars

**Non-Goals:**
- Protecting existing routes (HEL-34)
- Linking existing resources to users via `owner_id` (HEL-35)
- Google OAuth (HEL-32)
- Frontend login UI (HEL-38)

## Decisions

### 1. DB-backed sessions over JWT

The ticket requires "logout clears the session server-side." JWT tokens are stateless — revoking them requires a blacklist or short expiry. A `user_sessions` table row-deletion is the simplest and most correct implementation. Tradeoff: every authenticated request will need a DB lookup (acceptable; that's what HEL-34 implements).

### 2. `scala-bcrypt` over raw `jbcrypt`

`com.github.t3hnar:scala-bcrypt_2.13` wraps `org.mindrot:jbcrypt` and returns `Try` rather than throwing exceptions, composing cleanly with `Future`-based route handlers. Same underlying algorithm, same cost factor. **Human-approved decision** (escalated before planning).

### 3. Session token format: 256-bit hex via `SecureRandom`

`java.security.SecureRandom` is available in the JDK — no new dependency. 256 bits (32 bytes → 64 hex chars) is cryptographically sufficient. Stored as `text PRIMARY KEY` in `user_sessions`.

### 4. Register also creates and returns a session

After registering, the user is immediately logged in (a session token is issued). This avoids a redundant round-trip. Alternative: return only `201 Created` with no token, require a separate login call. Rejected — worse UX, no security benefit.

### 5. User enumeration resistance

Both "email not found" and "wrong password" on login return `401 Unauthorized` with the same body: `{"message": "Invalid email or password"}`. Timing: `scala-bcrypt`'s `checkpw` is constant-time by design; the "email not found" path still runs a dummy `BCrypt.checkpw` call to equalise timing.

**Alternative considered:** Returning `404` for unknown email. Rejected — leaks account existence.

### 6. `display_name` column is nullable

The ticket doesn't mention display names but HEL-38 (frontend auth UI) includes a registration form with a display name field. Adding the column now is cheap; leaving it nullable means it can be populated later without a migration. Self-approved.

### 7. Auth routes under `/api/auth/`

Consistent with REST conventions and with the existing `/api/dashboards/`, `/api/panels/` prefix pattern in `ApiRoutes.scala`. The new `AuthRoutes` class is injected into `ApiRoutes` like all other route classes.

### 8. No `ResourceMeta` on `User`

`User` doesn't need `lastUpdated` — users aren't patched in this ticket. The `users` table has only `created_at`. `ResourceMeta` (with `lastUpdated`) is added only if/when user profile editing is scoped.

### 9. Password validation in `RequestValidation`

Email regex and password length are checked in `RequestValidation.scala` (the existing validation helper), returning `Left(errorMessage)` on failure, consistent with how `importSnapshot` validation works.

## Risks / Trade-offs

- **Timing attack on login** → Dummy bcrypt check when email not found (see Decision 5).
- **Plaintext token in Authorization header over HTTP** → Acceptable for local dev; TLS enforcement is an infrastructure concern outside this ticket's scope.
- **Session table grows unboundedly** → Expired sessions are not pruned in this ticket. A background cleanup job or lazy expiry check on login is deferred. The `expires_at` column is present for HEL-34 to enforce.
- **`display_name` nullable** → `UserResponse` serialises it as `null` if absent; frontend must handle optionality.

## Migration Plan

Two new Flyway migrations:

- `V6__users.sql`: `users` table
- `V7__user_sessions.sql`: `user_sessions` table with FK → `users.id ON DELETE CASCADE`

No changes to existing tables. No data migration needed. Rollback: drop both tables (no existing data depends on them).

## Planner Notes

**Self-approved decisions:**
- Register also returns a session token (better UX, no security tradeoff)
- `display_name` nullable column added speculatively for HEL-38 compatibility
- Session expiry: 30 days (ticket doesn't specify; conventional default)
- Password minimum length: 8 chars (ticket says "minimum length" without specifying; 8 is conventional)
- No `ResourceMeta` on `User` (no update operations in scope)
- Auth under `/api/auth/` prefix (follows existing pattern)
- Dummy bcrypt call on unknown email to equalise timing
