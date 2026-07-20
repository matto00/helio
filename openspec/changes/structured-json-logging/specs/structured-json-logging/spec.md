## ADDED Requirements

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
