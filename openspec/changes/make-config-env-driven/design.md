## Context

The backend (`Main.scala`) already reads `HELIO_HTTP_HOST` and `HELIO_HTTP_PORT` for the HTTP listener, and `application.conf` already has `helio.db.url = ${?DATABASE_URL}`. The `AKKA_LICENSE_KEY` is also env-driven via HOCON substitution. No CORS middleware exists today. Logback level is hard-coded to `INFO` in `logback.xml`. There is no `.env.example` documenting required/optional env vars.

## Goals / Non-Goals

**Goals:**
- Add `PORT` as an alias for `HELIO_HTTP_PORT` so Cloud Run works without config (Cloud Run injects `PORT`)
- Expose individual DB params (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`) as env vars for cloud deployments that don't pass a full JDBC URL
- Make `LOG_LEVEL` configurable via env var (propagated through `application.conf` → Akka loglevel and logback root level)
- Add CORS middleware to Akka HTTP routes, reading allowed origins from `CORS_ALLOWED_ORIGINS` env var
- Create `.env.example` documenting every env var

**Non-Goals:**
- Dynamic config reload at runtime
- Secret management / vault integration
- Frontend changes

## Decisions

### D1: Port resolution order — `PORT` → `HELIO_HTTP_PORT` → 8080
Cloud Run injects `PORT`. The existing code checks `HELIO_HTTP_PORT`. Resolve with: check `PORT` first, then `HELIO_HTTP_PORT`, then default 8080. This preserves backward compatibility with local `.env` files that set `HELIO_HTTP_PORT`.
- Alternative: rename to `PORT` only — rejected, would break existing local dev setups.

### D2: DB params via HOCON substitutions in `application.conf`
Slick reads `helio.db.url`. For cloud deployments, add individual HOCON keys with env var substitutions:
```
url = "jdbc:postgresql://"${?DB_HOST}":"${?DB_PORT}"/"${?DB_NAME}
url = ${?DATABASE_URL}   # full URL takes precedence if set
```
And add `user = ${?DB_USER}`, `password = ${?DB_PASSWORD}`.
- Alternative: parse env vars in Scala code — rejected, HOCON substitutions are idiomatic for Akka/Slick.

### D3: Log level via `application.conf` HOCON + logback env substitution
Set `akka.loglevel = ${?LOG_LEVEL}` with `INFO` default in `application.conf`. Also update `logback.xml` to use `<property>` with a default so the root appender level is consistent:
```xml
<property name="LOG_LEVEL" value="${LOG_LEVEL:-INFO}" />
<root level="${LOG_LEVEL}">
```
- Alternative: only update Akka loglevel — rejected, logback root level would differ.

### D4: CORS via `akka-http-cors` library — wrap routes in `ApiRoutes`
Add `cors()` directive wrapping `health.routes ~ pathPrefix("api") { ... }` in `ApiRoutes`. Read `CORS_ALLOWED_ORIGINS` in `Main.scala` and pass as a `Seq[HttpOriginMatcher]` to `CorsSettings`. Default: `http://localhost:5173`.
- Alternative: handle CORS in the Vite proxy only — rejected, backend must be independently deployable.

### D5: `.env.example` at repo root
Document every required and optional env var with inline comments. This is the canonical reference for operators.

## Risks / Trade-offs

- [HOCON partial DB URL]: If only some of `DB_HOST/DB_PORT/DB_NAME` are set, the constructed JDBC URL will be malformed. Mitigation: document that either `DATABASE_URL` (full URL) or all four individual params must be provided.
- [CORS default `localhost:5173`]: Production deployments must set `CORS_ALLOWED_ORIGINS`. Mitigation: `.env.example` makes this explicit; startup logs the resolved origins.

## Migration Plan

1. Merge this branch — existing local `.env` files continue to work (all new vars are optional with defaults).
2. Cloud Run: add `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `CORS_ALLOWED_ORIGINS` to Cloud Run env config (or keep `DATABASE_URL` — both work).
3. No DB migration required.

## Planner Notes

Self-approved: this is a pure configuration change with no API surface changes. No escalation required.
