## 1. Backend

- [x] 1.1 In `backend/src/main/resources/logback.xml`, move the `<if>`/`<then>`/`<else>` conditional to the top level (directly under `<configuration>`, outside `<root>`).
- [x] 1.2 Define the `json` `<appender>` INSIDE the `<then>` branch and the `plain` `<appender>` INSIDE the `<else>` branch (only the selected appender is ever defined — no `not referenced` WARN).
- [x] 1.3 Give the `<then>` branch a full `<root level="${LOG_LEVEL}">` referencing the `json` appender, and the `<else>` branch a full `<root level="${LOG_LEVEL}">` referencing the `plain` appender.
- [x] 1.4 Preserve the `equalsIgnoreCase("json")` condition so any non-`json`/unset value resolves to plain.

## 2. Tests

- [x] 2.1 Run `sbt test` and confirm `StructuredJsonLoggingSpec` is green.
- [x] 2.2 Runtime-probe startup with `LOG_FORMAT=json`: confirm no `IfNestedWithinSecondPhaseElementSC` WARN and JSON lines with `severity`.
- [x] 2.3 Runtime-probe startup with `LOG_FORMAT` unset and a non-`json` value: confirm no nesting WARN and plain-text lines.
- [x] 2.4 Runtime-probe `LOG_LEVEL` (e.g. `WARN`) in both formats: confirm sub-threshold lines are suppressed.
