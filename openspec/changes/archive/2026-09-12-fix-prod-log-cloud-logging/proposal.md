## Why

Prod backend application/Flyway logs never reach Cloud Logging in a queryable, structured form,
making startup verification (e.g. confirming a migration applied) unreliable and blind exactly
when it matters most (HEL-1128, echoing the v0.7.x silent-startup incident).

## What Changes

- Fix the actual root cause of application/Flyway logger output never reaching stdout/stderr in
  prod, once local reproduction (built from the real Dockerfile + a real throwaway Postgres, run
  with prod-like env) probe-confirms it. **Confirmed via live read-only `gcloud logging read`**:
  `LOG_FORMAT=json` IS already set on the live Cloud Run service, and revision
  `helio-backend-00077-55c`'s entire stdout output is exactly 13 lines of logback's own internal
  bootstrap status text — zero JSON app/Flyway lines, ever. The "LOG_FORMAT is unset" theory from
  an earlier pass of this plan is disproven; see design.md for the corrected root-cause hunt.
- Add `LOG_FORMAT=json` explicitly to `.github/workflows/cd-backend.yml`'s `deploy-cloudrun`
  `--update-env-vars` list as hardening: the actual deploy path never sets it itself today; the
  live value only exists because of a historical, undocumented `infra/deploy-backend.sh` run.
  This closes real fragility but is NOT the fix for the reported symptom.
- No Cloud Run deploy, config change, or release tag as part of this change (explicit scope
  limit from the delivery instructions) — the real-deploy AC item stays open for a later manual
  verification pass.
- Round 2 (skeptic-final-1.md REFUTE): the round-1 fix (plain `${LOG_FORMAT:-plain}` property
  substitution) restored logging output for `LOG_FORMAT=json` exactly, but regressed the
  case-insensitive "any unrecognized value falls back to plain text" contract this capability's
  spec already required — `LOG_FORMAT=JSON` or a typo silently left the root logger with no
  appender again. Fixed with a Logback `<define>` (`com.helio.logging.LogFormatPropertyDefiner`,
  a `PropertyDefiner` — ordinary JVM code, not a conditional-processing construct) that normalizes
  `LOG_FORMAT` case-insensitively into exactly `json` or `plain` before the same unconditional
  `<appender-ref>` substitution. Probe-confirmed (same local Docker + real-Postgres repro) that
  `LOG_FORMAT=JSON` now gives JSON output and `LOG_FORMAT=garbage` gives plain-text output, never
  silence.

## Capabilities

### New Capabilities
(none — pure infra/config/logging-plumbing fix, no product-facing capability)

### Modified Capabilities

- `structured-json-logging` — the requirement that appender selection avoid Logback's
  `IfNestedWithinSecondPhaseElementSC` cosmetic startup warning (which required an `<if>` wrapping
  the root logger) is replaced by a requirement that appender selection use no
  conditional-processing construct at all in the appender-attachment path — the confirmed HEL-1128
  root cause. The case-insensitive-fallback behavior itself is unchanged; see
  `specs/structured-json-logging/spec.md` in this change directory for the full delta.

## Impact

- `.github/workflows/cd-backend.yml` (adds `LOG_FORMAT=json` to the deploy env vars, hardening)
- `backend/src/main/resources/logback.xml` — root-cause fix: appender selection with no `<if>`
- `backend/src/main/scala/com/helio/logging/LogFormatPropertyDefiner.scala` — new `PropertyDefiner`
  that case-insensitively normalizes `LOG_FORMAT` (round 2)
- No schema/migration changes expected

## Non-goals

- Deploying to prod, changing live Cloud Run env/secrets, or cutting a release — verification
  against a real deploy is an explicitly deferred, separately-tracked step (see ticket AC).
