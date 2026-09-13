# structured-json-logging Specification

## Purpose
Selects the backend's Logback console encoder at runtime — human-readable plain text for dev and structured JSON
(with MDC context and a Cloud Logging `severity` field) for production — via the `LOG_FORMAT` env var, so log output
is searchable in Cloud Logging without code changes.

## Requirements

### Requirement: Log output format is selectable via LOG_FORMAT env var

The backend SHALL select its Logback console encoder at startup based on the `LOG_FORMAT` environment variable.
When `LOG_FORMAT` is `json` (matched case-insensitively) the backend SHALL emit structured JSON log lines; for any
other value or when unset it SHALL emit human-readable plain-text lines. Switching formats SHALL require no code or
recompilation — configuration only.

#### Scenario: Production selects JSON output

- **WHEN** the backend starts with `LOG_FORMAT=json`
- **THEN** each log line written to stdout SHALL be a single JSON object (parseable as JSON)

#### Scenario: Dev defaults to plain text

- **WHEN** the backend starts with `LOG_FORMAT` unset
- **THEN** log lines SHALL use the existing human-readable pattern and SHALL NOT be JSON

#### Scenario: Unrecognized value falls back to plain text

- **WHEN** the backend starts with `LOG_FORMAT` set to a value that is not `json` under
  case-insensitive comparison, for example `garbage` or `text`
- **THEN** log lines SHALL use the human-readable plain-text format

### Requirement: JSON logs include level, message, logger, and MDC fields

When JSON output is active, each emitted log line SHALL include structured fields for the log level, the message,
the logger name, the thread, the timestamp, and all Mapped Diagnostic Context (MDC) entries present on the logging
thread. Exception stack traces SHALL be serialized into a single JSON string field rather than split across lines.

#### Scenario: MDC context appears as searchable fields

- **WHEN** a log statement is emitted with MDC entries populated and `LOG_FORMAT=json`
- **THEN** the JSON log line SHALL contain each MDC key as a field with its corresponding value

#### Scenario: Standard fields are present

- **WHEN** any log statement is emitted with `LOG_FORMAT=json`
- **THEN** the JSON line SHALL include the message, logger name, thread name, and timestamp as distinct fields

### Requirement: JSON logs expose a Cloud Logging severity field

When JSON output is active, each log line SHALL carry a top-level `severity` field derived from the log level so
that Google Cloud Logging classifies and filters entries by severity automatically.

#### Scenario: Error log is classified by severity

- **WHEN** an ERROR-level statement is logged with `LOG_FORMAT=json`
- **THEN** the JSON line SHALL contain a `severity` field reflecting the ERROR level

### Requirement: LOG_LEVEL continues to control root log level in both formats

The backend SHALL continue to honor the existing `LOG_LEVEL` environment variable (default `INFO`) as the root
logger level regardless of whether plain-text or JSON output is selected.

#### Scenario: Log level respected under JSON output

- **WHEN** the backend starts with `LOG_LEVEL=WARN` and `LOG_FORMAT=json`
- **THEN** statements below WARN SHALL NOT be emitted and emitted lines SHALL be JSON

### Requirement: Appender selection uses no conditional-processing construct

The backend's Logback configuration SHALL select the active console appender (plain or JSON)
without using Logback's `<if>` conditional-processing construct anywhere in the appender-attachment
path. Local reproduction (HEL-1128: a real Docker image built from the real `Dockerfile`, run
against a real throwaway Postgres) probe-confirmed that in this repo's exact toolchain (Logback
1.5.x + Janino, packaged via `sbt-assembly`'s fat jar), ANY use of `<if>` — regardless of nesting
position — leaves the root logger with no appender attached at runtime despite Logback reporting a
clean "End of configuration" with no error, silently dropping all application and Flyway log
output. Both console appenders SHALL be declared unconditionally, and the appender actually
attached to the root logger SHALL be selected by substituting an already-resolved property value
into a single `<appender-ref>` element. Case-insensitive normalization of `LOG_FORMAT` into that
property value (see the "Log output format is selectable via LOG_FORMAT env var" requirement's
"Unrecognized value falls back to plain text" scenario) SHALL be performed by ordinary JVM code
(a Logback `PropertyDefiner`) rather than by a conditional-processing construct evaluated inside
the appender-attachment path, so no `<if>`, `<condition>`, or Janino-scripted branch ever gates
whether an appender is attached to the root logger.

This requirement supersedes the previous "Startup emits no Logback config-nesting warning"
requirement, which required the opposite structure (an `<if>` wrapping the root logger) as its
means of avoiding logback's cosmetic `IfNestedWithinSecondPhaseElementSC` startup warning. That
structure is the confirmed root cause of HEL-1128 (prod application/Flyway logs never reaching
Cloud Logging) and is deliberately not reintroduced; avoiding the cosmetic warning is no longer a
requirement.

#### Scenario: JSON selection contains no conditional appender attachment

- **WHEN** the backend starts with `LOG_FORMAT=json`
- **THEN** the Logback configuration file SHALL contain no `<if>` element
- **AND** each log line written to stdout SHALL be a single JSON object carrying the `severity` field

#### Scenario: Unrecognized value falls back to plain text, not silence

- **WHEN** the backend starts with `LOG_FORMAT` set to a value that is not `json` under
  case-insensitive comparison, for example `garbage` or `text`
- **THEN** the root logger SHALL have the plain-text appender attached
- **AND** log lines SHALL use the human-readable plain-text format
- **AND** application and Flyway startup log lines SHALL still reach stdout (never silence)

#### Scenario: Case-insensitive JSON selection

- **WHEN** the backend starts with `LOG_FORMAT=JSON` (or any other casing of the literal `json`)
- **THEN** the root logger SHALL have the JSON appender attached
- **AND** each log line written to stdout SHALL be a single JSON object carrying the `severity` field
