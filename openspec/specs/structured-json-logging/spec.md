# structured-json-logging Specification

## Purpose
Selects the backend's Logback console encoder at runtime — human-readable plain text for dev and structured JSON
(with MDC context and a Cloud Logging `severity` field) for production — via the `LOG_FORMAT` env var, so log output
is searchable in Cloud Logging without code changes.
## Requirements
### Requirement: Log output format is selectable via LOG_FORMAT env var

The backend SHALL select its Logback console encoder at startup based on the `LOG_FORMAT` environment variable.
When `LOG_FORMAT=json` the backend SHALL emit structured JSON log lines; for any other value or when unset it SHALL
emit human-readable plain-text lines. Switching formats SHALL require no code or recompilation — configuration only.

#### Scenario: Production selects JSON output

- **WHEN** the backend starts with `LOG_FORMAT=json`
- **THEN** each log line written to stdout SHALL be a single JSON object (parseable as JSON)

#### Scenario: Dev defaults to plain text

- **WHEN** the backend starts with `LOG_FORMAT` unset
- **THEN** log lines SHALL use the existing human-readable pattern and SHALL NOT be JSON

#### Scenario: Unrecognized value falls back to plain text

- **WHEN** the backend starts with `LOG_FORMAT` set to a value other than `json`
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

### Requirement: Startup emits no Logback config-nesting warning

The backend's Logback configuration SHALL be structured so that startup produces no internal Logback status
warning about a conditional (`<if>`) nested within a second-phase element — specifically no
`IfNestedWithinSecondPhaseElementSC` warning — regardless of the `LOG_FORMAT` value. This SHALL be achieved without
altering appender selection, root level, MDC, or severity behavior: the `LOG_FORMAT`-based choice between the plain
and JSON console appenders SHALL be expressed so the conditional wraps the root logger rather than nesting inside it.

#### Scenario: No nesting warning in plain mode

- **WHEN** the backend starts with `LOG_FORMAT` unset (or any non-`json` value)
- **THEN** the Logback startup status output SHALL NOT contain an `IfNestedWithinSecondPhaseElementSC` warning
- **AND** log lines SHALL use the human-readable plain-text format

#### Scenario: No nesting warning in JSON mode

- **WHEN** the backend starts with `LOG_FORMAT=json`
- **THEN** the Logback startup status output SHALL NOT contain an `IfNestedWithinSecondPhaseElementSC` warning
- **AND** each log line SHALL be a single structured JSON object carrying the `severity` field

