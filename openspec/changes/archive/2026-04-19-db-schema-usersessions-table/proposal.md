## Why

The authentication system requires server-side session management so the backend can invalidate sessions on logout and reject expired tokens. Without a `user_sessions` table, sessions cannot be tracked or revoked server-side.

## What Changes

- New Flyway migration adds the `user_sessions` table with `id`, `user_id` (FK → users), `token` (unique, hashed), `created_at`, `expires_at`, `last_seen_at`, `ip_address`, and `user_agent` columns
- Index on `token` for fast lookup during request authentication
- Expired session cleanup strategy via periodic deletion of rows where `expires_at < now()`

## Capabilities

### New Capabilities

- `session-persistence`: Database schema and Flyway migration for the `user_sessions` table backing server-side session management

### Modified Capabilities

<!-- No existing spec-level requirement changes -->

## Non-goals

- Session creation, validation, or lookup logic (application layer — separate ticket)
- Token generation algorithm (separate ticket)
- API endpoints for session management (separate ticket)

## Impact

- New Flyway migration file in `backend/src/main/resources/db/migration/`
- Depends on the `users` table (HEL-30, already merged)
- No frontend changes required
