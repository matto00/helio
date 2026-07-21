# HEL-324 — Silence logback IfNestedWithinSecondPhaseElementSC startup WARN

URL: https://linear.app/helioapp/issue/HEL-324/silence-logback-ifnestedwithinsecondphaseelementsc-startup-warn
Priority: Low
Team: Helio Platform
Project: Deployment

## Context

Non-blocking cleanup flagged during HEL-115 (structured JSON logging, PR #255). At
backend startup, logback logs an `IfNestedWithinSecondPhaseElementSC` WARN because
the `<if>` conditional that selects the console appender (`plain` vs `json` via
`LOG_FORMAT`) sits **inside** the `<root>` element. The warning is cosmetic —
appender selection is correct in all `LOG_FORMAT` branches (verified by the HEL-115
final-gate skeptic across all four branches) — but it's noise on every boot.

## Task

Restructure `backend/src/main/resources/logback.xml` so the conditional wraps the
root rather than nesting inside it: move the `<if>`/`<then>`/`<else>` to the top
level with **two** `<root>` **branches** (one referencing the `plain` appender, one
the `json` appender), instead of a single `<root>` containing an inline `<if>`
appender-ref. Semantics must stay identical:

- `LOG_FORMAT=json` → JSON appender only; anything else (incl. unset/typo) → plain appender.
- `LOG_LEVEL` still drives the root level in both branches.
- MDC + Cloud Logging `severity` field preserved on the JSON path.

## Acceptance criteria

1. No `IfNestedWithinSecondPhaseElementSC` (or related nesting) WARN at startup, in
   both `plain` and `json` modes.
2. Appender selection + level behavior unchanged across all `LOG_FORMAT` values
   (runtime-verify all branches, as HEL-115 did).
3. `StructuredJsonLoggingSpec` still green; `sbt test` green.

## Notes

Pure cosmetic/hygiene cleanup deferred from HEL-115. Low priority.
