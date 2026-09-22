## 1. Backend

- [x] 1.1 Replace the hardcoded string literal in
      `backend/src/main/scala/com/helio/services/proposals/AuthoringTelemetry.scala:33`
      with `LoggerFactory.getLogger(getClass)` and verify
      `grep -n 'getLogger(' backend/src/main/scala/com/helio/services/proposals/AuthoringTelemetry.scala`
      shows the new call.
- [x] 1.2 Replace the hardcoded string literal in
      `backend/src/main/scala/com/helio/services/assistant/AssistantTelemetry.scala:29`
      with `LoggerFactory.getLogger(getClass)` and verify
      `grep -n 'getLogger(' backend/src/main/scala/com/helio/services/assistant/AssistantTelemetry.scala`
      shows the new call.
- [x] 1.3 Verify no other hardcoded, drifted `getLogger("com.helio...")` literal
      remains: `grep -rn 'getLogger("' backend/src/main` returns no matches.

## 2. Tests

- [x] 2.1 Update all 10 `JsonLogCapture.withCapture("com.helio.services.AuthoringTelemetry")`
      literals in `backend/src/test/scala/com/helio/services/proposals/AuthoringTelemetrySpec.scala`
      (lines 230, 258, 280, 304, 346, 392, 418, 446, 477, 497) to
      `"com.helio.services.proposals.AuthoringTelemetry$"`.
- [x] 2.2 Update all 5 `JsonLogCapture.withCapture("com.helio.services.AssistantTelemetry")`
      literals in `backend/src/test/scala/com/helio/services/assistant/AssistantTelemetrySpec.scala`
      (lines 182, 223, 252, 281, 312) to
      `"com.helio.services.assistant.AssistantTelemetry$"`.
- [x] 2.3 Verify `grep -rn 'withCapture("com.helio' backend/src/test` shows exactly
      15 matches, all naming a package that exists post-HEL-633.
- [x] 2.4 Run `sbt test` and verify `AuthoringTelemetrySpec` and
      `AssistantTelemetrySpec` pass (in particular the specs at each updated
      `withCapture` call site), and the full backend suite is green.

## Standing Constraints

- [C1] SONNET ON ALL AGENTS — never promote any sub-agent to opus (all roles
  pinned to sonnet per user instruction).
- [C2] Sub-agent Bash calls running commits/tests must use timeout 600000.
- [C3] Budget exhaustion or an auditor ESCALATE is a mandatory escalation to
  the human — no in-loop resolution.
- [C4] Never use `gh pr merge --auto`.
- [C5] Diff must be a pure logger-category rename only: 2 production
  getLogger literals + 15 test withCapture literals. No other files, no
  moves, no unrelated refactors (HEL-632 epic's iron constraint).
