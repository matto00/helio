## Context

HikariCP pool settings currently live in `backend/src/main/resources/application.conf` under the `helio.db` block, consumed by Slick via `slick-hikaricp 3.5.2`. Slick's `HikariCPJdbcDataSource` reads `numThreads`, `maxConnections`, `minimumIdle`, `idleTimeout`, and `maxLifetime` directly from the Typesafe Config block — no additional wrapper or `properties` sub-key is needed.

Current values: `numThreads = 10`, `maxConnections = 10` (both default to HikariCP's maximumPoolSize of 10). `minimumIdle`, `idleTimeout`, `maxLifetime` are not set, so HikariCP uses its defaults (idle = numThreads, idleTimeout = 600 000 ms, maxLifetime = 1 800 000 ms).

## Goals / Non-Goals

**Goals:**
- Set `maximumPoolSize = 5`, `minimumIdle = 0`, `idleTimeout = 30000`, `maxLifetime = 60000` in `application.conf`
- Add a comment block explaining the Cloud Run / Cloud SQL connection-exhaustion rationale

**Non-Goals:**
- Cloud SQL proxy configuration or IAM auth
- Connection monitoring or alerting
- Any frontend, API, or schema changes

## Decisions

### Use Slick native config keys (not a `properties` block)

Slick 3.5 maps `minimumIdle`, `idleTimeout`, and `maxLifetime` directly to HikariCP setters in `HikariCPJdbcDataSource.scala`. Setting them in the `helio.db` config block is idiomatic and keeps the config in one place.

**Alternative considered**: Override via a `properties {}` sub-block. Rejected — the direct keys are already supported and more readable.

### Replace `numThreads` / `maxConnections` with `numThreads` + `maximumPoolSize`

Slick uses `maxConnections` (or `maximumPoolSize`) as the HikariCP pool ceiling. The current config sets both `numThreads` and `maxConnections` to 10. The new config sets `numThreads = 5` (controls Slick's async executor thread count) and `maximumPoolSize = 5` explicitly, matching the ticket requirement and removing the ambiguous `maxConnections` alias.

### Comment placement

A `# Cloud Run connection tuning` comment block is placed immediately above the pool parameters in `application.conf` to make the rationale discoverable without requiring a separate document.

## Risks / Trade-offs

- **Small pool under burst load** → Mitigation: Cloud Run auto-scales horizontally; 5 connections per instance × N instances is the intentional design. Request queuing at HikariCP level handles brief bursts within a single instance.
- **maxLifetime < Cloud SQL idle timeout** → This is intentional; connections are recycled before Cloud SQL can close them, preventing `connection reset` errors in long-lived instances.
- **Local dev impact** → Pool of 5 is more than sufficient for single-developer local use; no functional regression.

## Planner Notes

Self-approved: pure config change, no new dependencies, no API surface changes, no migration needed. Change is additive (new keys) and one existing key (`maxConnections`) is removed in favour of the more explicit `maximumPoolSize`.
