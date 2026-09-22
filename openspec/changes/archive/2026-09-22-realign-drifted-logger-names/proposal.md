## Why

HEL-633 moved `AuthoringTelemetry`/`AssistantTelemetry` to new packages
(`services/proposals/`, `services/assistant/`) but deliberately left their
hardcoded `LoggerFactory.getLogger("com.helio.services.<Name>")` string literals
naming the old package, to keep that repackage's diff a provable pure move. Since
then every log line these two objects emit carries a category that disagrees with
its source file's actual package.

## What Changes

- `AuthoringTelemetry.scala:33` and `AssistantTelemetry.scala:29`: replace the
  hardcoded string literal with `LoggerFactory.getLogger(getClass)`, so the
  category is derived from the class and can never drift from a future move
  again. Both are Scala `object`s, so the resulting category carries a trailing
  `$` (`com.helio.services.proposals.AuthoringTelemetry$` /
  `com.helio.services.assistant.AssistantTelemetry$`) — this repo already has
  13+ precedents of `object`s using this exact pattern.
- Update all 15 (re-derived from the tree; the ticket's filed count of 12 was
  stale) `JsonLogCapture.withCapture("com.helio.services.*Telemetry")` literals
  across `AuthoringTelemetrySpec.scala` (10) and `AssistantTelemetrySpec.scala`
  (5) to the new category strings, in the same commit.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — this is a pure logger-category rename with no spec-level behavior
change; confirmed no `<logger name="com.helio...">` config or resource file keys
off either category string. `skip_specs: true` set in `.openspec.yaml`.)

## Impact

- `backend/src/main/scala/com/helio/services/proposals/AuthoringTelemetry.scala`
- `backend/src/main/scala/com/helio/services/assistant/AssistantTelemetry.scala`
- `backend/src/test/scala/com/helio/services/proposals/AuthoringTelemetrySpec.scala`
- `backend/src/test/scala/com/helio/services/assistant/AssistantTelemetrySpec.scala`

No API, schema, or config changes. No other files touched — the one behaviour
change HEL-632's epic permits for this spinoff ticket.

## Non-goals

- No other logger literals in the tree are touched (verified via
  `grep -rn 'getLogger("' backend/src/main` — only these two exist).
- No further HEL-632-epic repackaging work (HealthRoutes move, ai/+email/ move)
  — those are separate, sequential lanes (HEL-811, HEL-802).
