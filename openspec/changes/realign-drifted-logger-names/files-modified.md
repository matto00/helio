# Files Modified — HEL-803

- `backend/src/main/scala/com/helio/services/proposals/AuthoringTelemetry.scala` — replaced the hardcoded pre-HEL-633 logger literal `"com.helio.services.AuthoringTelemetry"` with `LoggerFactory.getLogger(getClass)`, matching the class's actual (post-HEL-633) package.
- `backend/src/main/scala/com/helio/services/assistant/AssistantTelemetry.scala` — same fix: replaced the hardcoded pre-HEL-633 logger literal `"com.helio.services.AssistantTelemetry"` with `LoggerFactory.getLogger(getClass)`.
- `backend/src/test/scala/com/helio/services/proposals/AuthoringTelemetrySpec.scala` — updated all 10 `JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry")` literals to `"com.helio.services.proposals.AuthoringTelemetry$"`, matching the new `getClass`-derived category.
- `backend/src/test/scala/com/helio/services/assistant/AssistantTelemetrySpec.scala` — updated all 5 `JsonLogCapture.withCapture("com.helio.services.AssistantTelemetry")` literals to `"com.helio.services.assistant.AssistantTelemetry$"`, matching the new `getClass`-derived category.
