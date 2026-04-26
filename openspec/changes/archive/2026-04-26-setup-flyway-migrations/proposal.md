## Why

The Flyway migration infrastructure is substantially in place (dependency, Database.scala, V1–V16 SQL files, test harness), but the database connection configuration
does not support separate username/password credentials — required for Cloud SQL in production. The `Database.scala` Flyway call passes `null, null` for credentials, and
`application.conf` has no `DB_USER`/`DB_PASSWORD` overrides. This gap must be closed before the backend can connect to a Cloud SQL instance.

## What Changes

- `application.conf`: add `user` and `password` fields under `helio.db`, each overridable via `DB_USER` / `DB_PASSWORD` env vars
- `Database.scala`: read username and password from config and pass them to both the Flyway `dataSource()` call and Slick (already handles it via config fields)
- `CLAUDE.md`: document the production env vars (`DATABASE_URL`, `DB_USER`, `DB_PASSWORD`)

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `backend-persistence`: database connection now supports separate username/password env vars for production use

## Impact

- `backend/src/main/resources/application.conf` — new config fields
- `backend/src/main/scala/com/helio/infrastructure/Database.scala` — reads credentials from config
- `CLAUDE.md` — documents production env vars

## Non-goals

- Cloud SQL provisioning (covered by HEL-75 epic scope)
- HikariCP pool tuning for serverless
- Migration-as-separate-job pattern (startup migration is acceptable for v1)
