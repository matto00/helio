# HEL-803: Realign two hardcoded logger names left stale by the backend repackage

## Description

Spinoff from HEL-633, filed during planning as a deliberately-deferred item (design.md D9).

Two files hardcode their own logger category as a string literal naming their old
(pre-HEL-633) package:

- `backend/src/main/scala/com/helio/services/proposals/AuthoringTelemetry.scala:33`
- `backend/src/main/scala/com/helio/services/assistant/AssistantTelemetry.scala:29`

both of the form:

```scala
private val log: Logger = LoggerFactory.getLogger("com.helio.services.<Name>")
```

HEL-633 moved these files to `services/proposals/` and `services/assistant/`
respectively. The hardcoded string no longer matches the class's actual package, so
the emitted log category is wrong.

Not fixed in HEL-633 itself because editing it renames a live log category (a
behaviour change), and HEL-632's iron constraint for the whole repackage epic was
that the diff contain moves, package declarations, imports, and READMEs only.

Verified at the time (and re-verified during this ticket's premise validation) that
leaving it was safe: there are zero `com.helio` references anywhere in
`backend/src/main/resources/` other than one unrelated `PropertyDefiner` class
reference in `logback.xml`, and `logback.xml` declares only `<root>` — no
`<logger name="com.helio...">` keys off these categories. Nothing filters, routes,
or alerts on them today.

## What to do

Replace both hardcoded literals with `LoggerFactory.getLogger(getClass)`, so the
category can never drift from the class again — this repo already has 13+
precedents of `object`s using this exact pattern (`PipelineAnalyzeService`,
`SqlConnectorDriver`, `LocalFileSystem`, `GcsFileSystem`, `PanelRowMapper`,
`PanelAppearance`, `PatchSetUndoConflictCheck`, `PatchSetApplyRollback`,
`PdfTextSupport`, `ClaudeSseAssembler`, `ContentSourceSupport`,
`TopLevelErrorHandlers`, `RewrapConnectorCredentialsJob`).

Both `AuthoringTelemetry` and `AssistantTelemetry` are Scala `object`s, so
`getClass` yields the synthetic module class name with a trailing `$`. Resolved
category strings:

- `com.helio.services.proposals.AuthoringTelemetry$`
- `com.helio.services.assistant.AssistantTelemetry$`

A `grep -rn 'getLogger("' backend/src/main` confirms these are the only two
hardcoded, drifted category literals in the whole main tree.

## Scope: test literals must move too (premise-corrected: 15, not 12)

The ticket as filed says 12 `JsonLogCapture.withCapture("com.helio.services.*Telemetry")`
string literals assert on these exact category names, across
`AuthoringTelemetrySpec.scala` and `AssistantTelemetrySpec.scala`. Re-derivation
against the current tree found **15**, not 12:

- `AuthoringTelemetrySpec.scala`: 10 occurrences (lines 230, 258, 280, 304, 346,
  392, 418, 446, 477, 497)
- `AssistantTelemetrySpec.scala`: 5 occurrences (lines 182, 223, 252, 281, 312)

All 15 must be updated to the new category strings above, in the same commit as
the two production literal changes.

## Acceptance Criteria

- `AuthoringTelemetry.scala:33`'s hardcoded string literal is replaced with
  `LoggerFactory.getLogger(getClass)`.
- `AssistantTelemetry.scala:29`'s hardcoded string literal is replaced with
  `LoggerFactory.getLogger(getClass)`.
- All 15 `JsonLogCapture.withCapture("com.helio.services.*Telemetry")` literals in
  `AuthoringTelemetrySpec.scala` (10) and `AssistantTelemetrySpec.scala` (5) are
  updated to `com.helio.services.proposals.AuthoringTelemetry$` /
  `com.helio.services.assistant.AssistantTelemetry$` respectively, matching the
  new `getClass`-derived category strings exactly.
- `grep -rn 'withCapture("com.helio' backend/src/test` after the change shows the
  same count (15) and every literal names a package that actually exists.
- No other file changes — this is a pure logger-category rename, the one
  behaviour change HEL-632's epic permits for this ticket. No moves, no other
  refactors.
- `sbt test` passes, including `AuthoringTelemetrySpec` and
  `AssistantTelemetrySpec`.
