# HEL-30: DB schema: Users table

## Summary

Create the `users` table as the foundation for all auth and ownership features.

## Scope

- Flyway migration: `users` table with `id` (UUID), `email` (unique), `display_name`, `avatar_url`, `created_at`, `updated_at`
- `auth_provider` enum: `google` | `local`
- `password_hash` (nullable — only set for local auth)
- `google_id` (nullable — only set for Google OAuth)
- Seed/demo data updated to reference a system user

## Acceptance criteria

- Migration runs cleanly on a fresh DB
- `email` and `google_id` have unique constraints
- `password_hash` is never returned by any API response
