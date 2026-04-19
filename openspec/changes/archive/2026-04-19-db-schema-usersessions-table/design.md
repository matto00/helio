## Context

A `user_sessions` table was partially introduced in V7__user_sessions.sql, but it is missing several columns required by the ticket: `id` (UUID PK), `last_seen_at`, `ip_address`, `user_agent`, and the `token` index for fast lookup. The current schema uses `token` as the primary key (plaintext), which conflicts with the acceptance criterion that tokens be stored as secure hashes.

The `users` table (V6__users.sql) is already in place. HEL-30 is merged.

## Goals / Non-Goals

**Goals:**
- Replace V7 with a complete `user_sessions` schema via a new corrective migration (V10)
- Add all columns required by the ticket spec
- Add an index on `token` for fast lookup
- Document expired-session cleanup strategy

**Non-Goals:**
- Application-layer session creation, validation, or invalidation logic
- Token generation or hashing implementation
- API endpoints for session management

## Decisions

**Corrective migration rather than modifying V7**: Flyway migrations are immutable once applied to any environment. V7 is already in place in development. A new migration (V10) drops and recreates `user_sessions` with the full schema. This is safe since the table has no application code consuming it yet.

**`id` UUID as primary key, `token` unique**: Using a surrogate UUID PK is consistent with all other tables (`users`, `dashboards`, panels, etc.). `token` gets a unique constraint plus a separate index, matching the lookup pattern.

**`token` stored as hash (TEXT)**: The column stores only the hashed form. Raw tokens never hit the database. This satisfies the acceptance criterion. The hashing algorithm is chosen at the application layer (out of scope here).

**`last_seen_at` nullable**: Newly created sessions have not been used yet; NULL represents "never used". On first use, the application updates this column.

**Expired session cleanup via periodic deletion**: A scheduled job (application layer, separate ticket) will `DELETE FROM user_sessions WHERE expires_at < now()`. No TTL index is available in PostgreSQL; a background task is the standard approach.

## Risks / Trade-offs

- Dropping V7 data in local dev environments → acceptable since no application code uses the table yet
- `token` column length: TEXT is flexible but slightly larger than a fixed CHAR(64). Acceptable given query volume.

## Migration Plan

1. Add `V10__user_sessions_complete.sql` that: `DROP TABLE IF EXISTS user_sessions CASCADE` then recreates with full schema
2. Run `sbt test` to verify migrations apply cleanly
3. Rollback: drop the new migration file and re-run (no prod data at stake)

## Planner Notes

Self-approved: this is purely additive infrastructure with no breaking API changes and no frontend impact.
