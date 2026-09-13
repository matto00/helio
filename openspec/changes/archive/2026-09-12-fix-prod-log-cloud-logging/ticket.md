# HEL-1128: Prod backend application logs never reach Cloud Logging (no startup/Flyway lines)

## Description

The prod backend's application logs do not reach Cloud Logging.

Observed 2026-09-12, during the v0.8.0 deploy verification:

* Revision `helio-backend-00077-55c` (v0.8.0) produced 13 stdout lines, all logback initialisation, plus request logs. There was no startup line, no Flyway output, and nothing from the app after logback configured itself.
* The previous revision `helio-backend-00076-sx5` showed only request logs in a 300-entry sample.
* `LOG_FORMAT=json` is set by `infra/deploy-backend.sh` so that each line becomes searchable fields (HEL-115). Either those JSON lines are not emitted, or Cloud Logging does not ingest them.

Why it matters: confirming that V106 applied had to be done by inference from code ordering (Flyway before `HttpServer.start`, `halt(1)` on failure) instead of simply reading the Flyway line. The v0.7.x release incident was hard to see for the same reason — a silent startup.

Suspects to check:

* the logback JSON encoder's output stream: stdout vs stderr, and whether the appender attaches after an `<if>` condition (logback warns that condition attribute is deprecated);
* log level under the prod config;
* whether Cloud Run parses the JSON — for example a missing `message` field, or a multi-line or buffered write.

## Acceptance Criteria

* On a fresh revision, startup and Flyway lines (for example "Successfully applied" or "Schema is up to date") are queryable in Cloud Logging, with `severity` parsed.
* A known app log line is findable by a structured field.
* Verified against a real deploy, not only locally.

## Premise-validation findings (Setup, orchestrator — round 2, corrected after design-gate REFUTE)

* Round 1 theorized `LOG_FORMAT` was unset in prod because `.github/workflows/cd-backend.yml`
  (the actual deploy path) never sets it. The design-gate skeptic correctly flagged this as
  unproven. **Live read-only `gcloud run services describe helio-backend --region=us-west1`
  confirms `LOG_FORMAT=json` IS set on the service today** — it persisted from a historical
  `infra/deploy-backend.sh` run, since Cloud Run env vars survive across `--update-env-vars`
  (additive) redeploys. Round 1's theory is disproven.
* **Live read-only `gcloud logging read` against revision `helio-backend-00077-55c` confirms the
  real defect**: stdout for that revision's entire lifetime is exactly 13 lines, all plain-text
  logback-internal bootstrap status messages (not app output) — zero JSON app/Flyway lines ever
  appear, on stdout or stderr, despite the health check passing ~10s later (the app did start).
  Root cause is still open (fat-jar logging classpath merge, a Pekko/SLF4J logging-adapter
  startup gap, or something else) — Execution must reproduce locally against the real Dockerfile
  + a real throwaway Postgres and probe-confirm the cause per
  `.concertino/laws/systematic-debugging` before writing any fix. See design.md for the full
  evidence and the enumerated suspects.
* `cd-backend.yml` still never sets `LOG_FORMAT` explicitly itself — this is real, independent
  fragility (a future full env replacement would silently drop it) and is fixed as hardening,
  but is explicitly NOT the root-cause fix for this ticket's reported symptom.

## Scope constraint (from delivery instructions)

* No Cloud Run deploy, env/secret change, or release tag as part of this delivery. The real-deploy verification AC item remains open, to be verified by the driver after the next release cut.
