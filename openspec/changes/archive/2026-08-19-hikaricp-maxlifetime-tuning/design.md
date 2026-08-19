## Context

`backend/src/main/resources/application.conf` configures two HikariCP pools (`helio.db`,
`helio.db.privileged`) against Cloud SQL Postgres via the Google Cloud SQL Java connector
(`com.google.cloud.sql:postgres-socket-factory:1.21.0`, wrapping
`jdbc-socket-factory-core:1.21.0`). Both pools currently set `maxLifetime = 60000` (60s),
`minimumIdle = 2` (HEL-696), `idleTimeout = 30000`, `maximumPoolSize = 5`.

Prod is mid-incident: `SQLTransientConnectionException`/`Broken pipe` 503s recurring at
regular ~60-90s intervals under near-zero traffic (ruled out load: Cloud SQL CPU 8-9%,
0-1 Cloud Run instances, clean Cloud SQL server logs).

## Goals / Non-Goals

**Goals:**
- Ground the proposed `maxLifetime` change in HikariCP's own documented/source behavior and
  the Cloud SQL connector's actual certificate-refresh mechanics, not just the observed
  symptom, before changing the number.
- Stop the pool from proactively recycling idle, unused connections on a ~60-90s clock.

**Non-Goals:**
- Re-litigating HEL-696's `minimumIdle=2` decision.
- Changing `maximumPoolSize` or `idleTimeout`.
- Running the post-deploy prod verification window (requires a live deploy; tracked
  separately, not a merge gate for this change).

## Decisions

### Decision: Root-cause verified against HikariCP 5.1.0 source (vendored, matches
`build.sbt`'s `slick-hikaricp % 3.5.2` → HikariCP 5.1.0 transitive dependency)

Read `com/zaxxer/hikari/HikariConfigMXBean.java` and `HikariPool.java` from the project's own
resolved `HikariCP-5.1.0-sources.jar` (`~/.cache/coursier`):

- `getMaxLifetime()` javadoc: *"This property controls the maximum lifetime of a connection in
  the pool. When a connection reaches this timeout, **even if recently used**, it will be
  retired from the pool. An in-use connection will never be retired, **only when it is idle
  will it be removed**."* — confirms the ticket's claim: with `minimumIdle=2` keeping
  connections idle in the pool between requests, those idle connections are exactly the ones
  `maxLifetime` proactively retires, independent of whether they were ever used for a query.
- `housekeepingPeriodMs` defaults to 30000ms (`HikariPool.java:66`), sweeping the pool every
  30s. A connection created at T0 is evicted at the first sweep ≥ T0+maxLifetime — with
  `maxLifetime=60000`, that lands 60-90s after creation depending on sweep phase. This matches
  the observed error cadence (`00:29:37`, `00:30:58`, `00:32:13`, ...) almost exactly.
- `HikariConfig.java:1044-1046`: HikariCP itself treats `maxLifetime < 30000ms` as invalid and
  silently resets it to the built-in default (30 min) with a warning — i.e. HikariCP's own
  validation logic considers anything close to 60000ms already at the extreme aggressive end
  of what it considers sane.
- `HikariConfig.java:55`: `private static final long MAX_LIFETIME = MINUTES.toMillis(30);` —
  HikariCP's own default is 30 minutes, not 60 seconds.

### Decision: Root-cause verified against the Cloud SQL Java connector's own cert-refresh design
(vendored `jdbc-socket-factory-core-1.21.0-sources.jar`)

`RefreshCalculator`/`RefreshAheadStrategy` show the connector maintains ephemeral certificates
on its **own independent background schedule** (`DEFAULT_REFRESH_BUFFER = 4 minutes`; refreshes
well ahead of the certs' own ~1hr validity), entirely decoupled from any individual JDBC
connection's lifetime. This means recycling the physical JDBC connection every 60s buys **no**
credential-freshness benefit — the connector already keeps credentials fresh in the background
regardless of how long a given pooled connection stays open. Forcing a new physical
connection (TCP + TLS handshake through the connector) every 60-90s is pure overhead with a
correctness/reliability downside (each new handshake is a new failure opportunity), not a
security necessity.

### Decision: Target value — 1 800 000 ms (30 min) on both pools

Matches HikariCP's own default exactly (not an arbitrary number), comfortably under Postgres/
Cloud SQL's own (effectively unbounded by default) idle-connection limits, and well inside the
cert validity window the connector manages independently. `idleTimeout=30000` is unaffected —
HikariCP's own validation (`idleTimeout + 1s > maxLifetime && minIdle < maxPoolSize` disables
idleTimeout) does not trigger here (`31000 << 1800000`), so excess-above-`minimumIdle`
connections still get trimmed after 30s exactly as before; only the unconditional periodic
recycle of the 2 warm `minimumIdle` connections is what changes.

### Decision: Also correct `hikaricp-pool-config`'s stale `minimumIdle` spec text

The canonical spec still states `minimumIdle` of `0`, never updated when HEL-696 shipped
`minimumIdle=2`. Since this change already rewrites the same requirement block for the
`maxLifetime` delta, the `minimumIdle` wording is corrected in the same delta (doc-only,
no additional code change — `application.conf` already has `2`).

## Risks / Trade-offs

- [Risk] A connection open for 30 min could, in principle, be stale if Cloud SQL restarts the
  underlying instance mid-lifetime. → Mitigation: HikariCP's connection test on
  borrow/`isValid()` check plus normal `SQLException` handling on the query path already covers
  this; not a new failure mode introduced by raising `maxLifetime` (Postgres/Cloud SQL do not
  impose a shorter idle/session timeout that this would violate).
- [Risk] None of this fixes the underlying masking behavior where a 503 during handshake
  surfaces as a misleading CORS error to the client (documented in HEL-696, unchanged here). →
  Out of scope for this hotfix; both HEL-696 and this ticket treat it as a known, separate,
  pre-existing issue.

## Migration Plan

Single config edit, no migration. Deploy via existing `infra/deploy-backend.sh` path (or
whatever mechanism ships this PR). Rollback is reverting the two `maxLifetime` values (and the
spec delta) — no state to unwind.

## Planner Notes

- Self-approved: correcting the pre-existing `minimumIdle` spec drift alongside the `maxLifetime`
  delta, since both live in the same requirement block being touched. No new `application.conf`
  change beyond what the ticket asked for.
- Self-approved: chose exactly HikariCP's own default (30 min) over an arbitrary value in the
  ticket's suggested 25-30 min range, since matching the library's own documented default is
  the most defensible, least-arbitrary choice and needs no further justification per pool.
