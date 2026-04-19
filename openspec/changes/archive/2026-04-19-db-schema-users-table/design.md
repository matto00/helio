## Context

The `users` table was partially introduced in V6 with a minimal schema (`id`, `email`, `password_hash NOT NULL`, `display_name`, `created_at`). V7 added `user_sessions` and V8 added `google_id` and `avatar_url` via ALTER TABLE. The resulting schema is inconsistent with the ticket requirements:

- `password_hash` is `NOT NULL` in V6 but must be nullable (Google OAuth users have none)
- `auth_provider` enum is absent entirely
- `updated_at` is absent
- V8 adds columns via ALTER instead of having them in the initial V6 schema

The Slick `UserRow` maps `passwordHash: String` (non-optional), and `upsertGoogleUser` inserts `""` as a placeholder — an obvious workaround for the NOT NULL constraint. This is a data integrity hole.

Existing migrations V6, V7, V8 have already run in development. We cannot change them. We need a new migration (V9) that fixes the schema forward.

## Goals / Non-Goals

**Goals:**
- Add `auth_provider` enum and column to `users`
- Make `password_hash` nullable via ALTER TABLE
- Add `updated_at` column with default
- Update the Slick `UserRow`/`UserTable` to reflect nullable `password_hash` and the new columns
- Update `UserRepository` methods that set `passwordHash = ""` to use `None`
- No seeded system user row needed — `DemoData` uses a string `"demo-seed"` as `createdBy` on `ResourceMeta`, not a FK to `users`

**Non-Goals:**
- New API endpoints
- Frontend changes
- Migrating existing data (dev DB will be wiped and re-migrated)

## Decisions

**Decision: Add V9 migration rather than modifying V6/V7/V8**
Flyway migrations are immutable once applied. V6–V8 are already in the repository history and may have run in CI or a staging DB. We add a new V9 migration that applies the forward-compatible changes.

Alternatives considered:
- Rewrite V6 in place: safe only if we also delete V7 and V8 and re-sequence. Too disruptive given V7 and V8 contain real schema that downstream tickets depend on.
- Use a repair script: not applicable — no Flyway repair is set up.

**Decision: `auth_provider` as a PostgreSQL enum type**
Consistent with the ticket spec. Stored as enum in PG, mapped to a Scala sealed trait via a custom Slick column type.

**Decision: `password_hash` made nullable via `ALTER COLUMN ... DROP NOT NULL`**
Simple ALTER suffices. No data migration needed (existing dev rows will have `""` which will be updated to `NULL` is out of scope — dev DB is reset per migration run).

**Decision: Update `UserRow.passwordHash` to `Option[String]`**
All callers (`insert`, `upsertGoogleUser`) must be updated. `getPasswordHash` already returns `Future[Option[String]]` so the signature is unchanged.

## Risks / Trade-offs

- [Risk] V6 `password_hash` has existing `""` values in any persistent dev DB → Mitigation: acceptable for dev; prod doesn't exist yet.
- [Risk] Slick projection changes (`UserRow`) require touching multiple files → Mitigation: bounded change (repository + domain), no API layer change.

## Migration Plan

1. Add `V9__users_schema_fix.sql` with:
   - `CREATE TYPE auth_provider AS ENUM ('google', 'local')`
   - `ALTER TABLE users ADD COLUMN auth_provider auth_provider`
   - `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`
   - `ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
2. Update `UserRow` in `UserRepository.scala`: `passwordHash: Option[String]`
3. Update `UserTable`: `passwordHash = column[Option[String]]("password_hash")`
4. Update `insert` method: accept `Option[String]` instead of `String`
5. Update `upsertGoogleUser`: pass `None` for `passwordHash` instead of `""`
6. Add `AuthProvider` sealed trait to `domain/model.scala`
7. Run `sbt test` to verify

## Planner Notes

- `DemoData.scala` uses `createdBy = "demo-seed"` on `ResourceMeta` which is a plain String, not a FK reference to `users.id`. No seed user row is needed — the dashboards/panels tables store `created_by TEXT`, not a UUID FK. Confirmed by reading V1__init.sql pattern.
- `updated_at` is added with `DEFAULT now()` so existing rows get a sensible value.
- `auth_provider` column will be `NULL` for existing rows; downstream ticket can backfill or make it NOT NULL in a later migration once all rows are set.
