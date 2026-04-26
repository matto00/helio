## Why

Cloud Run instances are ephemeral and scale horizontally; the default HikariCP pool size (10) means many concurrent instances each holding 10 connections quickly exhausts Cloud SQL's connection limit. Tuning the pool to small, short-lived values prevents connection exhaustion without impacting throughput on single instances.

## What Changes

- `maximumPoolSize` reduced from default (10) to **5**
- `minimumIdle` reduced from default (10) to **0** — idle connections are not held open between requests
- `idleTimeout` set to **30 000 ms** — idle connections are released after 30 s
- `maxLifetime` set to **60 000 ms** — connections are recycled after 60 s, staying well within Cloud SQL's idle connection timeout

A comment block is added to the configuration source documenting the Cloud Run / Cloud SQL rationale.

## Capabilities

### New Capabilities

_(none — this is a configuration change, no new spec-level capability is introduced)_

### Modified Capabilities

_(none — existing `backend-persistence` spec requirements are unchanged; only internal pool tuning values change)_

## Impact

- `backend/src/main/resources/application.conf` (or equivalent HikariCP config location) — pool parameter values updated
- No API contract changes; no schema changes; no frontend changes
- Local development: smaller pool is sufficient for single-instance dev use

## Non-goals

- Changing the database driver or connection library
- Adding connection-count monitoring or Cloud SQL proxy configuration
- Any changes outside the HikariCP pool settings
