# HEL-95: Set up Flyway for schema migrations

## Description

Add Flyway to the backend build. Migrate the existing schema out of Slick's `DBIO.createSchema` (or wherever DDL currently lives) into numbered SQL migration files in `backend/src/main/resources/db/migration/`. Run migrations on startup or as a separate job.

## Context

Upon inspection of the codebase, Flyway has already been partially integrated in prior work:
- Flyway dependencies (`flyway-core` 10.20.1, `flyway-database-postgresql` 10.20.1) are already in `build.sbt`
- `Database.scala` already calls `Flyway.configure().dataSource(...).locations("classpath:db/migration").load().migrate()` on startup
- Migration files V1 through V16 already exist in `backend/src/main/resources/db/migration/`
- All test specs already use Flyway with embedded Postgres
- `application.conf` exposes `DATABASE_URL` env var override for the JDBC URL

The remaining work is to document the production environment variables needed for proper database configuration, as the current `Database.scala` passes `null` for username and password (relying on the URL to embed credentials), and to ensure `application.conf` supports all necessary production connection parameters.

## Acceptance Criteria

- Flyway is wired into the startup sequence (already done via Database.scala)
- Existing schema is expressed as numbered migration files (V1-V16 already exist)
- Migrations run on startup (already wired in Database.scala)
- Production database credentials can be configured via environment variables
- The CLAUDE.md and application.conf reflect the production env var requirements
