## ADDED Requirements

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
