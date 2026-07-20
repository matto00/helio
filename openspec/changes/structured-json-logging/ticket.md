# HEL-115 — Configure structured JSON logging in backend

**Team:** Helio Platform
**Project:** Deployment · **Milestone:** Observability
**Parent:** HEL-80
**Priority:** Medium
**URL:** https://linear.app/helioapp/issue/HEL-115/configure-structured-json-logging-in-backend

## Description

Add `net.logstash.logback:logstash-logback-encoder` dependency. Configure
`logback.xml` to output JSON in production (keep plain text in dev via Logback
profiles). Include MDC fields. Cloud Logging will parse JSON payloads into
searchable fields automatically.

## Acceptance criteria (derived)

- `net.logstash.logback:logstash-logback-encoder` added as a backend dependency.
- Logback configured so production emits structured JSON log lines; dev/local
  keeps human-readable plain-text output.
- Profile-based switching (Logback profiles / env-driven) selects the encoder —
  no code changes required to flip between formats.
- MDC fields are included in the JSON output so contextual fields are searchable.
- Cloud Logging (GCP) can parse the JSON payload into searchable structured
  fields automatically (severity + message + MDC mapped appropriately).
