## Context

Flyway is already wired into `Database.scala` and the dependency is declared in `build.sbt`. Migration files V1–V16 exist in `backend/src/main/resources/db/migration/`. The
only gap is that `Flyway.configure().dataSource(url, null, null)` passes null credentials, and `application.conf` has no `DB_USER`/`DB_PASSWORD` override paths. For local
dev with URL-embedded credentials this works; for Cloud SQL it does not.

Current `application.conf`:

```
helio.db {
  url = "jdbc:postgresql://localhost:5432/helio"
  url = ${?DATABASE_URL}
  driver = "org.postgresql.Driver"
  connectionPool = "HikariCP"
  numThreads = 10
  maxConnections = 10
}
```

Slick's `Database.forConfig` already reads `user` and `password` from config if present; they just need to be declared with env-var fallbacks.

## Goals / Non-Goals

**Goals:**
- Support production DB credentials via `DB_USER` / `DB_PASSWORD` env vars
- Pass those credentials to Flyway's `dataSource()` call
- Document the env vars in `CLAUDE.md`

**Non-Goals:**
- Cloud SQL provisioning
- Pool tuning for Cloud Run
- Migration-as-separate-job

## Decisions

**Decision: Read user/password from config in Database.scala**

`application.conf` will declare `user` and `password` with `${?DB_USER}` / `${?DB_PASSWORD}` env-var fallbacks. `Database.init` reads these via `dbConfig.getString`
(returning empty string when absent, which Flyway treats as no-auth — same behaviour as today for local dev). Both Flyway and Slick will use the same source of truth.

Alternative: separate env vars read with `sys.env.getOrElse` directly in `Database.scala`. Rejected: `application.conf` is already the config contract; bypassing it adds
a second config path.

**Decision: Empty string not null for absent credentials**

`Config.getString` returns the literal value or throws if unset; we use `dbConfig.hasPath` + `getString` pattern with a fallback to empty string. Flyway accepts empty
string as "no auth", matching the current null behaviour.

## Risks / Trade-offs

- [Risk] Config typo (e.g. `DB_USR`) silently uses empty credentials → Mitigation: document env var names explicitly in `CLAUDE.md`
- [Risk] Race condition if multiple Cloud Run instances migrate simultaneously → Out of scope for v1; noted in proposal non-goals

## Migration Plan

1. Add `user`/`password` fields to `application.conf` with env-var overrides
2. Update `Database.init` to read and forward credentials
3. Update `CLAUDE.md` backend env var table
4. Run `sbt test` to confirm no regressions (tests use embedded Postgres with explicit credentials passed directly, so they are unaffected)

## Planner Notes

Self-approved. Change is narrow config wiring with no API surface changes and no breaking behaviour for existing local dev setup.
