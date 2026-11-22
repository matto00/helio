## Why

HEL-1637 grew `ClaudeClient.scala` to 455 lines and three assistant spec files (`AssistantServiceSpec` 957,
`ClaudeClientSpec` 928, `AssistantConversationRoutesSpec` 765) further past CONTRIBUTING.md's ~250-line soft budget
(and past the ~400-line "propose a split" line). Its PR notes recorded a split plan: the tool-loop helpers out of
`ClaudeClient`, and the failure-budget / input-stop tests into their own spec files.

## What Changes

- Move `ClaudeClient`'s pure request-building and block-conversion helpers into sibling files in
  `com.helio.infrastructure.ai`, verbatim, leaving `send` / `stream` / `sendWithTools` and every logging call in
  `ClaudeClient`. No public signature changes; no behaviour changes.
- Split the three oversized spec files into cohesive smaller spec files plus shared test-support fixtures. Every test
  keeps its full name (`<subject> should <title>`) and its assertions byte-for-byte; only the file it lives in
  changes.
- Record the before/after test counts per suite and per full test name, and the full `sbt testFull` total, and commit
  them as evidence.

## Capabilities

### New Capabilities

### Modified Capabilities

(none: a behaviour-preserving refactor; `skip_specs: true`)

## Impact

- Backend main: `infrastructure/ai/ClaudeClient.scala` plus new sibling file(s) in the same package.
- Backend test: `infrastructure/ai/ClaudeClientSpec.scala`, `services/assistant/AssistantServiceSpec.scala`,
  `api/routes/assistant/AssistantConversationRoutesSpec.scala`, plus new spec / support files beside them.
- No wire change, no schema change, no migration, no frontend.

## Non-goals

- Fixing any defect found while moving code: it becomes a follow-up through triage, never a silent fix.
- Touching `AssistantConversationService` / `AssistantConversationRepository` (sibling lane HEL-1802).
- Changing the ask loop (`AskDataService`, HEL-1745) or the thinking-block handling (`ClaudeHistoryNormalizer`,
  HEL-1636) beyond their unchanged call sites.
