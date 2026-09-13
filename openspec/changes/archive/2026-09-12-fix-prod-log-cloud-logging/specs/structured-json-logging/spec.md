## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Startup emits no Logback config-nesting warning

**Reason**: This requirement mandated an `<if>` wrapping the root logger (rather than nesting
inside it) specifically to avoid Logback's `IfNestedWithinSecondPhaseElementSC` startup warning.
HEL-1128's local reproduction (real Dockerfile + real throwaway Postgres) probe-confirmed that
this exact structure — `<if>` wrapping `<root>` — is the root cause of prod's application/Flyway
logs never reaching Cloud Logging: it leaves the root logger with no appender attached at runtime
in this repo's toolchain, despite Logback reporting a clean "End of configuration". The
appender-attachment path no longer contains any `<if>` at all (see the "Appender selection uses no
conditional-processing construct" requirement above), so the `IfNestedWithinSecondPhaseElementSC`
warning this requirement guarded against no longer applies to this configuration shape, and
avoiding it is no longer a meaningful requirement.

**Migration**: None. No caller-visible behavior is removed — `LOG_FORMAT`'s selection semantics,
including the case-insensitive-fallback behavior, are preserved and clarified by the requirement
above.
