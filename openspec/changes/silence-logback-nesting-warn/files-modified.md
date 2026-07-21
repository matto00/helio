# Files modified — HEL-324

- `backend/src/main/resources/logback.xml` — Lifted the `LOG_FORMAT` `<if>`/`<then>`/`<else>` conditional
  to the top level (directly under `<configuration>`, outside `<root>`) with two complete
  `<root level="${LOG_LEVEL}">` branches — `<then>` → `json` appender, `<else>` → `plain` appender. Each
  `<appender>` is defined **inside** its own branch so only the selected one is ever declared;
  `equalsIgnoreCase("json")` is preserved so any non-`json`/unset value resolves to plain. Silences the
  `IfNestedWithinSecondPhaseElementSC` startup WARN **and** avoids the `Appender named [...] not referenced`
  WARN (nothing is declared-but-unreferenced), with appender selection / LOG_LEVEL / MDC / severity
  semantics identical. Result: completely clean startup status in every branch.

The only committed source change is `logback.xml`. A temporary probe spec
(`LogbackConfigProbeSpec.scala`) was written to capture Logback startup status output for the verification
below, then deleted before commit (design non-goal: `logback.xml` is the only edited file).

---

## Verification evidence (systematic-debugging + verification-before-completion)

### Root cause (baseline, probe-confirmed)

The `<if>` selecting the console appender sat **inside** `<root>`. `<root>` is a Logback second-phase element,
so nesting `<if>` inside it trips the `IfNestedWithinSecondPhaseElementSC` sanity check (WARN on every boot).

**Probe:** load the real `logback.xml` via `JoranConfigurator` against a fresh `LoggerContext` and dump
`ctx.getStatusManager.getCopyOfStatusList` (`p("LOG_FORMAT")` reads process env, so each run is a faithful
runtime branch).

**BASELINE (pre-change config), `LOG_FORMAT=json`** — nesting WARN present (`level=1` = WARN):

```
[level=1] <if> elements cannot be nested within an <appender>, <logger> or <root> element
[level=1] See also https://logback.qos.ch/codes.html#nested_if_element
[level=1] Element <root> at line 26 contains a nested <if> element at line 27
[level=0] Condition [p("LOG_FORMAT").equalsIgnoreCase("json")] evaluated to true on line 27
[level=0] Attaching appender named [json] to Logger[ROOT]
ROOT_LEVEL=INFO
ROOT_APPENDER name=json class=ch.qos.logback.core.ConsoleAppender
```

### Intermediate finding (resolved)

A first pass kept both appenders declared **unconditionally** at the top level (the original design decision).
That removed the nesting WARN but introduced a *different* `level=1` WARN in each branch —
`Appender named [plain]/[json] not referenced. Skipping further processing.` — because only the selected
branch referenced its appender. The orchestrator confirmed the ticket's goal is a **fully clean** startup, so
the final config defines each `<appender>` **inside** its own branch; only the selected appender is ever
declared, so nothing is unreferenced.

### POST-CHANGE (final config) — ZERO warn/error status lines in every branch

`WARN_OR_ERROR_COUNT` = count of Logback config-parse status messages with `level >= WARN` (covers both the
`IfNestedWithinSecondPhaseElementSC` nesting WARN and the `Appender named [...] not referenced` WARN).

| Branch (env)                       | WARN_OR_ERROR_COUNT | ROOT_LEVEL | ROOT_APPENDER |
| ---------------------------------- | ------------------- | ---------- | ------------- |
| `LOG_FORMAT=json`                  | 0                   | INFO       | json          |
| `LOG_FORMAT=plain`                 | 0                   | INFO       | plain         |
| `LOG_FORMAT` unset                 | 0                   | INFO       | plain         |
| `LOG_FORMAT=jsonx` (typo)          | 0                   | INFO       | plain         |
| `LOG_FORMAT=json  LOG_LEVEL=WARN`  | 0                   | WARN       | json          |
| `LOG_FORMAT=plain LOG_LEVEL=WARN`  | 0                   | WARN       | plain         |

- Selection unchanged: `json` → json appender; unset / plain / typo → plain appender.
- `LOG_LEVEL` still drives the root level (WARN when set) → INFO is sub-threshold and suppressed. Root
  appender is `ConsoleAppender` with the config's LogstashEncoder (json) / PatternLayoutEncoder (plain);
  `StructuredJsonLoggingSpec` independently proves the json encoder emits parseable JSON with a top-level
  `severity` field + MDC and the plain encoder emits the human-readable pattern (not JSON).

## Gate results

`cd backend && sbt test`:

```
[info] Run completed in 51 seconds, 704 milliseconds.
[info] Total number of tests run: 1475
[info] Suites: completed 74, aborted 0
[info] Tests: succeeded 1475, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 53 s
```

`sbt testOnly ...StructuredJsonLoggingSpec`:

```
[info] Tests: succeeded 5, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```
