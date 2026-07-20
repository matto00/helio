## Why

The backend logs plain-text lines via a fixed Logback pattern. In production (Cloud Run → Cloud Logging),
plain text collapses into a single unstructured `textPayload`, so severity, logger, thread, and MDC context are
not searchable/filterable fields. Structured JSON output lets Cloud Logging parse each line into indexed fields
automatically, which is a prerequisite for the Observability milestone (HEL-80).

## What Changes

- Add the `net.logstash.logback:logstash-logback-encoder` dependency to the backend build.
- Configure `logback.xml` to select the log encoder at runtime: structured JSON in production, human-readable
  plain text in dev/local — driven by an env var, requiring no code change to flip formats.
- The JSON encoder emits standard fields (timestamp, level, logger, thread, message, stack trace) plus all MDC
  entries, and maps level to a Cloud Logging `severity` field so log-based filtering/alerting works.
- Preserve the existing `LOG_LEVEL` behavior (root level still honored in both formats).

## Capabilities

### New Capabilities

- `structured-json-logging`: backend log output format is selectable between plain text (dev) and structured
  JSON (production) via configuration, with MDC context and Cloud Logging severity mapping included in the JSON
  payload.

### Modified Capabilities

<!-- None. LOG_LEVEL behavior in backend-env-config is preserved unchanged; no existing requirement changes. -->

## Impact

- `backend/build.sbt` — new dependency.
- `backend/src/main/resources/logback.xml` — appender/encoder selection.
- Deployment/env docs — new env var documented for production.
- No application (Scala) source or API-contract changes; runtime behavior differs only in log line format.

## Non-goals

- No changes to what gets logged, log levels, or where MDC values are populated (no new instrumentation).
- No log shipping/aggregation infrastructure beyond Cloud Logging's automatic JSON parsing.
- No frontend changes.
