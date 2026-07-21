## Why

The backend's `logback.xml` places the `<if>` conditional that selects the console appender **inside** the `<root>`
element. Logback treats `<root>` as a second-phase element, so on every boot it logs a cosmetic
`IfNestedWithinSecondPhaseElementSC` WARN. Appender selection is correct, but the noise appears on every startup
(flagged as non-blocking cleanup during HEL-115).

## What Changes

- Restructure `backend/src/main/resources/logback.xml` so the `<if>`/`<then>`/`<else>` sits at the **top level**,
  outside `<root>`, with two `<root>` branches — one referencing the `plain` appender, one the `json` appender —
  instead of a single `<root>` containing an inline `<if>` appender-ref.
- Selection semantics stay identical: `LOG_FORMAT=json` → JSON appender only; any other value (incl. unset/typo) →
  plain appender. `LOG_LEVEL` still drives the root level in both branches; MDC + Cloud Logging `severity` preserved
  on the JSON path.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `structured-json-logging`: add a requirement that backend startup produces no Logback config-nesting warning
  (`IfNestedWithinSecondPhaseElementSC`), while all existing appender-selection, level, MDC, and severity behavior
  is preserved unchanged.

## Impact

- `backend/src/main/resources/logback.xml` (config only — no Scala code change).
- No API, schema, or dependency changes. `StructuredJsonLoggingSpec` must remain green.

## Non-goals

- No change to log format, field set, severity mapping, or the `LOG_FORMAT` / `LOG_LEVEL` contract.
- No new logging appenders, encoders, or dependencies.
