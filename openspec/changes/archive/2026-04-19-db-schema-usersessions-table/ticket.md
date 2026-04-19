# HEL-31 — DB schema: UserSessions table

## Summary

Create the `user_sessions` table to back server-side session management.

## Scope

- Flyway migration: `user_sessions` with `id` (UUID), `user_id` (FK → users), `token` (unique, hashed), `created_at`, `expires_at`, `last_seen_at`
- Optional metadata columns: `ip_address`, `user_agent`
- Index on `token` for fast lookup
- Expired session cleanup strategy (e.g. periodic deletion or TTL index)

## Acceptance criteria

- Sessions are invalidated server-side on logout
- Expired sessions do not authenticate requests
- Token stored as a secure hash (not plaintext)
