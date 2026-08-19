# HEL-748: Prod: Cloud SQL connection-storm 503s recurred despite HEL-696 fix — HikariCP maxLifetime=60s forces handshake churn every ~60-90s

## Description

Recurrence of HEL-696's exact symptom, confirmed live 2026-08-19 via `gcloud logging read` against `helio-backend`: `SQLTransientConnectionException: helio.db.privileged - Connection is not available (total=0, active=0, idle=0)` + `SocketException: Broken pipe` during Cloud SQL TLS handshake, surfacing to the client as `POST /api/proposals/apply` — "CORS Missing Allow Origin" (the response short-circuits before the `cors()` wrapper attaches headers, same masking behavior HEL-696 documented).

**Confirmed HEL-696's fix is still deployed** — `application.conf` currently has `minimumIdle = 2` on both `helio.db` and `helio.db.privileged` pools, not reverted to 0. This is a genuine recurrence under the existing mitigation, not a regression of that specific setting.

**New evidence pointing at a second contributing factor, `maxLifetime`:**

* Ruled out load: Cloud SQL CPU held at 8-9% throughout the incident window (Cloud Monitoring), only 0-1 Cloud Run instances active, Cloud SQL's own server logs show completely normal operation (routine autovacuum/checkpoint, zero errors) — this is not a traffic-driven storm.
* Error timestamps cluster at strikingly regular ~60-90s intervals (e.g. `00:29:37`, `00:30:58`, `00:32:13`, `00:33:38`, `00:34:51`) even under near-zero real traffic (single user testing).
* `application.conf`'s `helio.db`/`helio.db.privileged` both set `maxLifetime = 60000` (60s) — HikariCP's housekeeper (default 30s sweep) forces a full connection recycle, and therefore a fresh Cloud SQL TLS handshake via the connector library, on that same ~60-90s cadence *regardless of whether the connection was ever used*. The Cloud SQL Java connector's handshake (fetching ephemeral certs via the Cloud SQL Admin API) is comparatively expensive/fragile, and forcing it on a 60s clock — rather than reusing connections for their full practical lifetime — looks like the residual driver of periodic failures even with `minimumIdle=2` keeping the pool "warm."

## Acceptance Criteria

* Raise `maxLifetime` substantially (e.g. 25-30 minutes) on both `helio.db` and `helio.db.privileged` pools in `application.conf`, comfortably under Cloud SQL's own connection idle/wait timeout, so the pool stops forcing a fresh handshake on a tight clock independent of actual usage.
* The reasoning behind the fix (maxLifetime forcing periodic Cloud SQL TLS handshakes independent of traffic) must be cross-checked against HikariCP's own documented behavior and Cloud SQL connector guidance before the number is simply changed.
* Backend-only Scala/HOCON config change — no frontend impact. Standard `sbt test` + lint gates apply; no Playwright/live-UI verification needed.
* Re-verify against `gcloud logging read` for a sustained window post-deploy with zero new `SQLTransientConnectionException`/`Broken pipe` entries (mirroring HEL-696's own acceptance criteria) — noted as a post-deploy production verification step; not blocking for PR merge since it requires a live prod deploy window.

## Context

This is a live production incident hotfix filed 2026-08-19. Related: HEL-696 (prod privileged DB pool minimumIdle=0 causes connection storm 503s) — that fix (minimumIdle=2) is still in place and is not being reverted; this ticket addresses a second, distinct contributing factor (maxLifetime).
