## Context

README.md currently covers local development only. Operators deploying to Cloud Run have no authoritative reference for the production setup. The backend reads environment variables via `application.conf` (`DATABASE_URL`, `AKKA_LICENSE_KEY`); the Dockerfile produces a fat JAR runtime image.

## Goals / Non-Goals

**Goals:**
- Add a self-contained "Running in production" section to README.md
- Cover all required env vars (sourced from `application.conf`)
- Document Docker build command and expected output image
- Document Flyway migration execution (runs automatically on startup)
- Document Cloud Run deployment steps
- Document log locations (Cloud Run → Cloud Logging / stdout)

**Non-Goals:**
- CI/CD automation
- Terraform or infrastructure-as-code
- Staging environment docs
- Secrets management deep-dives

## Decisions

**Place section at the end of README.md, before "Contributing"**
Rationale: preserves the existing local-dev flow at the top; production ops are a secondary concern for most readers.

**Document only env vars read by `application.conf`**
`DATABASE_URL` and `AKKA_LICENSE_KEY` are the two vars consumed at runtime. No other vars exist today; adding phantom vars would mislead operators.

**Migrations are automatic on startup**
Flyway runs on server start via `Database.scala`; no separate migration command is needed. The doc should reflect this rather than suggesting a manual step.

**Logs via Cloud Run stdout → Cloud Logging**
The backend uses slf4j/akka loggers that write to stdout. Cloud Run automatically forwards stdout to Cloud Logging; no additional configuration is required.

## Risks / Trade-offs

- [Risk] Env var names change in future and README drifts → Mitigation: keep the list minimal and close to `application.conf` so drift is obvious during code review.

## Planner Notes

Self-approved — docs-only change, no architectural decisions required.
