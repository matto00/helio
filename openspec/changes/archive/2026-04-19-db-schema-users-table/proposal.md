## Why

All auth and ownership features require a persistent identity for users. No `users` table exists yet, making it impossible to associate sessions, credentials, or resources with a real account. This migration establishes that foundation before any auth flows land.

## What Changes

- New Flyway migration adds the `users` table and `auth_provider` enum type
- `users` table columns: `id` (UUID PK), `email` (unique, not null), `display_name`, `avatar_url`, `created_at`, `updated_at`, `auth_provider` (enum), `password_hash` (nullable), `google_id` (nullable, unique)
- Demo/seed data updated to insert a system user row so existing seeded data has a valid `created_by` reference

## Capabilities

### New Capabilities

- `user-persistence`: Database-level schema for storing user identity, credentials, and OAuth linkage

### Modified Capabilities

<!-- No existing spec-level requirements change — this is purely additive schema work -->

## Impact

- `backend/src/main/resources/db/migration/` — new migration file
- `DemoData.scala` — seed insert for system user
- No API endpoints added or modified in this ticket
- `password_hash` must never appear in any API response (enforced at the model/serialisation layer)

## Non-goals

- No new API endpoints (registration/login are separate tickets)
- No frontend changes
- No Slick model or repository layer (handled in downstream tickets)
- No session or token tables (separate migration)
