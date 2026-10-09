## Purpose

Keeps local (non-CI) test and dev entry points within fixed worker and heap caps no larger than CI's, so several
concurrent delivery lanes fit on one development machine without changing CI's or production's behaviour.

## ADDED Requirements

### Requirement: Local jest runs are capped at or below CI's worker count
When the `CI` environment variable is unset, every jest invocation reachable from `npm test` (root and frontend
configs, including the husky pre-commit hook path) SHALL run with a fixed maximum worker count no greater than CI's
effective worker count (3), regardless of the machine's core count, and SHALL recycle workers whose idle memory
exceeds a configured limit.

#### Scenario: Pre-commit hook on a 12-thread machine
- **WHEN** `npm test` runs with `CI` unset on a 12-thread machine
- **THEN** each jest run uses at most the configured local worker cap (no more than 3), not cores minus one

#### Scenario: CI behaviour unchanged
- **WHEN** jest's effective configuration is printed with `CI=true` before and after this change
- **THEN** the two outputs are identical apart from fields that depend on the checkout path (`cacheDirectory` is NOT exempt: it must also be unchanged under CI)

### Requirement: Local Playwright runs are capped at or below CI's worker count
When `CI` is unset, Playwright SHALL run with a fixed worker count no greater than CI's (2) instead of a
core-proportional default; with `CI` set the worker count SHALL remain 2.

#### Scenario: Local e2e run
- **WHEN** `npm run e2e` runs with `CI` unset on a 12-thread machine
- **THEN** at most the configured local worker cap of browsers run concurrently

### Requirement: Local backend JVMs have an explicit heap cap
When `CI` is unset, forked test JVMs and the forked `sbt run` JVM SHALL start with an explicit maximum heap no larger
than CI's effective per-JVM heap, and forked test groups SHALL run at a concurrency no greater than CI's (2). With `CI`
set, these JVM options and concurrency SHALL be unchanged. Production artefacts (the assembled jar and its runtime
JVM flags) SHALL be unaffected.

#### Scenario: Local sbt testFull
- **WHEN** `sbt testFull` runs with `CI` unset
- **THEN** every forked test JVM reports a max heap equal to the configured local cap, not 1/4 of physical RAM

#### Scenario: Production image untouched
- **WHEN** the Dockerfile, Cloud Run deploy flags, prod `application.conf` and frontend build config are diffed
  against the base branch
- **THEN** there is no change

### Requirement: Caps are overridable for a one-off local run
Each local cap SHALL be overridable for a single invocation through a documented environment variable, without editing
tracked files.

#### Scenario: One-off override
- **WHEN** a developer sets the documented override variable for a single local jest run
- **THEN** that run uses the overridden worker count and later runs return to the default cap
