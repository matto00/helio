## Why

Prod is mid-incident: `helio.db`/`helio.db.privileged`'s `maxLifetime = 60000` forces HikariCP's
housekeeper (30s sweep) to proactively retire and recycle every idle pooled connection every
~60-90s, regardless of traffic, each recycle paying for a fresh Cloud SQL TLS handshake. This
is the residual driver of `SQLTransientConnectionException`/`Broken pipe` 503s recurring under
HEL-696's existing `minimumIdle=2` mitigation, confirmed against near-zero-traffic prod logs.

## What Changes

- Raise `maxLifetime` on both `helio.db` and `helio.db.privileged` from `60000` (60s) to
  `1800000` (30 min) in `backend/src/main/resources/application.conf` — HikariCP's own default,
  comfortably under any Cloud SQL-imposed idle/connection limit and under the ~1hr validity
  window the Cloud SQL Java connector already manages independently via its own background
  ephemeral-cert refresh (unrelated to individual JDBC connection lifetime).
- Update the stale in-file tuning comment to reflect the corrected rationale.
- Correct `hikaricp-pool-config`'s existing spec requirements: the `maxLifetime` value, plus a
  pre-existing `minimumIdle` doc-drift (spec still says `0`; `application.conf` has said `2`
  since HEL-696 shipped, with no accompanying spec update at the time) — a documentation-only
  correction, not a behavior change, made incidentally because this change already touches the
  same requirement text.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `hikaricp-pool-config`: `maxLifetime` requirement changes from 60 000 ms to 1 800 000 ms on
  both the app and privileged pools; `minimumIdle` wording corrected from `0` to `2` to match
  already-shipped HEL-696 behavior (doc-only, no new code change).

## Impact

- `backend/src/main/resources/application.conf` — two `maxLifetime` values, one comment block.
- `openspec/specs/hikaricp-pool-config/spec.md` — via delta, on archive.
- No API/schema/frontend impact. No migration. Backend restart (redeploy) picks up the new
  config; existing pooled connections are unaffected until they age out naturally.

## Non-goals

- Not reverting or touching `minimumIdle`, `maximumPoolSize`, or `idleTimeout` (HEL-696's fix
  stays exactly as deployed).
- Not adding retry/backoff logic around connection acquisition — out of scope for this hotfix.
- Not performing the post-deploy `gcloud logging read` production verification window here —
  that requires an actual prod deploy, tracked as a follow-up step, not a PR-merge gate.
