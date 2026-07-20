## Evaluation Report — Cycle 1

Change: structured-json-logging (HEL-115) · Executor commit 609db058 · Backend/infra-only.

### Phase 1: Spec Review — PASS

All ticket acceptance criteria and spec scenarios are addressed, verified with fresh evidence:

- **AC: encoder dependency added** — `net.logstash.logback:logstash-logback-encoder` 7.4 (+ `janino` 3.1.12 for `<if>`) in `backend/build.sbt`. ✓
- **AC: prod JSON / dev plain, config-only switch** — `logback.xml` defines `plain` + `json` ConsoleAppenders; root selects via `<if condition='p("LOG_FORMAT").equalsIgnoreCase("json")'>`. No code change flips formats. ✓
- **Scenario: JSON selected** — runtime-verified: started backend with `LOG_FORMAT=json`, condition evaluated true, `json` appender attached, each stdout line is a valid JSON object (validated via `json.loads`). ✓
- **Scenario: default plain** — the `StructuredJsonLoggingSpec` run loaded the real `logback.xml` with `LOG_FORMAT` unset; logback attached `plain`. ✓
- **Scenario: unrecognized → plain (no silent log loss)** — `equalsIgnoreCase("json")` returns false for any non-`json` value → `<else>` attaches `plain`; never a dangling `ref`. This is the correct fix vs `${LOG_FORMAT:-plain}`. ✓
- **AC/Scenario: JSON includes level/message/logger/thread/timestamp + MDC; stack traces single-field** — runtime line has `@timestamp`, `message`, `logger_name`, `thread_name`, `severity`, `level_value`; unit test asserts MDC keys (`requestId`, `userId`) appear as fields. LogstashEncoder serializes stack traces to a single field by default. ✓
- **AC/Scenario: top-level `severity` for Cloud Logging** — `<fieldNames><level>severity</level></fieldNames>` renames level to `severity`; runtime lines show `"severity":"INFO"` / `"WARN"`; test asserts `severity=ERROR` and absence of a `level` key. ✓
- **Scenario: LOG_LEVEL preserved in both formats** — `<root level="${LOG_LEVEL}">` retained unchanged. ✓

Tasks: all 15 items marked `[x]` and match the implementation. No scope creep — only logging build/config/docs/deploy files touched, matching the proposal's stated impact. No regressions; no API/schema surface affected.

### Phase 2: Code Review — PASS

- **Canonical code-quality [mechanical]** — `npm run check:scala-quality` re-run: clean (only pre-existing soft file-size warnings, none for the new 123-line test). No inline FQNs. ✓
- **Design-standard [mechanical]** — N/A (no `frontend/**`).
- **DRY / readable / modular** — test uses a single `capture(encoder, loggerName)` helper for both paths; comments explain the non-obvious `setMDCAdapter` wiring and the typo-safe selection rationale. ✓
- **Type safety / security** — no untyped escapes. No secrets committed; `LOG_FORMAT=json` in the deploy `--set-env-vars` is non-sensitive. Runtime confirmed Flyway's existing URL masking still applies. ✓
- **Error handling** — the core robustness property (unrecognized value → plain, never no-appender) is implemented and verified. ✓
- **Tests meaningful** — drive the real `LogstashEncoder` and `PatternLayoutEncoder` reflectively; assert JSON parses with `severity` + MDC + standard fields and that the plain path is not JSON. A regression (e.g. lost `severity` mapping or an encoder/Jackson linkage break) would fail here. `sbt testOnly StructuredJsonLoggingSpec` re-run: 5/5 pass. ✓
- **No dead code / no over-engineering** — none. ✓

Flagged item 1 (`-n` commit bypass): Confirmed only `check:openspec` was bypassed — re-running it fails solely with "change is complete (15/15) but not archived", which is a legitimate later-phase concern (archiving follows review). `check:scala-quality` re-run clean by me; the commit body explicitly documents the bypass and which hooks pass, satisfying CONTRIBUTING's "call it out explicitly" requirement. Working tree is clean apart from `workflow-state.md` (a workflow artifact, not code). Non-blocking.

### Phase 3: UI Review — N/A

Backend/infra-only change. No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**` (only the change's own delta under `openspec/changes/`). No UI surface to exercise.

### Overall: PASS

No blocking issues. Both executor-flagged items judged non-blocking with fresh evidence.

### Non-blocking Suggestions

- **logback `IfNestedWithinSecondPhaseElementSC` WARN — cosmetic, not a defect.** The WARN fires (3x observed at startup) because `<if>` is nested inside `<root>`. Verified it does NOT degrade appender selection: with `LOG_FORMAT` unset logback attached `plain`; with `LOG_FORMAT=json` it attached `json` and emitted valid JSON. logback processes the nested conditional correctly in both branches. The suggested cleaner structure (two `<root>` branches wrapped in a top-level `<if>`) would silence the WARN with identical typo-safe semantics but is not required for this ticket's correctness — reasonable as a spinoff cleanup.
- `severity` uses logback's `WARN` vs GCP's `WARNING`; already acknowledged in design Decision #3 as tolerated by Cloud Logging. No action needed.
