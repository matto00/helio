## Why

HEL-660's bounded Claude tool-use loop already terminates gracefully at the *transport* layer
(`HopBudgetExhausted`, `isError` tool-results for a `Left`-returning executor) — but three of its
real failure modes never reach the user or telemetry: a hop-cap-hit's synthetic message is computed
then discarded before the frontend ever sees it, an executor that throws (vs. returns `Left`) can
still crash the whole turn, and a zero-result `find` has no distinct signal or guidance at all. HEL-
401 gave the older single-shot authoring flow first-class error UX and telemetry; this ticket gives
the newer tool loop the same treatment, closing gaps confirmed by reading the current code, not
assumed from the ticket text.

## What Changes

- Harden `ClaudeClient.executeTool`: any executor failure (thrown exception or a failed `Future`,
  not just an explicit `Left`) becomes an `isError` tool_result, never a failed loop `Future`.
- `AssistantService.converse` computes and exposes a new `searchedWithNoResults` signal (the turn's
  last executed tool was a zero-result `find`, immediately followed by a final text response with
  no captured proposal) alongside the existing `hopBudgetExhausted`.
- `POST /:id/converse` surfaces both signals on its response (two new `Option[Boolean]` fields on
  the existing `AssistantConversationResponse` — populated only by converse, `None` on `GET`: an
  ephemeral per-call signal, not new persisted transcript state).
- System-prompt guidance: when `find` returns nothing AND the goal is too underspecified to
  confidently build a `propose_pipeline`/`propose_combined` call, ask a clarifying question instead
  of guessing — the existing "don't give up, propose anyway" guidance stays for goals concrete
  enough to act on.
- Frontend: a dangling, unresolved `tool_use` (the hop-cap-exhausted case) renders a "cut short"
  indicator instead of looking permanently stuck; the final assistant turn gets a distinct visual
  treatment when either new signal is true.
- New `AssistantTelemetry` object (sibling to `AuthoringTelemetry`, same MDC/log-line pattern, own
  `assistant_tool_loop_outcome` event) recording tool-call count, hop-cap-hit, and no-results per
  turn — a new capability, not a merge into HEL-401's authoring-specific telemetry event.

## Capabilities

### New Capabilities

- `assistant-tool-loop-telemetry`: structured per-turn telemetry for the assistant tool loop
  (tool-call count, hop-cap-hit, no-results), mirroring `authoring-error-telemetry`'s pattern.

### Modified Capabilities

- `claude-api-client`: "a failed tool execution is fed back... not raised as an exception" widens
  from `Left`-only to any executor failure.
- `assistant-conversation-loop`: `converse`/`AssistantTurnResult` gains `searchedWithNoResults`.
- `assistant-live-converse`: the converse response surfaces both new turn-outcome signals.
- `chat-message-rendering`: dangling tool_use + no-result/hop-cap turn treatment.

## Impact

- Backend: `ClaudeClient.scala`, `ClaudeModels.scala` (maybe), `AssistantService.scala`,
  `AssistantSystemPrompt.scala`, `AssistantProtocol.scala`, `AssistantConversationProtocol.scala`,
  `AssistantConversationRoutes.scala`, new `AssistantTelemetry.scala`.
- Frontend: `ToolCallIndicator.tsx`, `MessageTurn.tsx`, `assistantConversationsSlice.ts`.
- `schemas/assistant-conversation.schema.json`: gains 2 optional properties matching
  `AssistantConversationResponse`'s 2 new fields (design-gate round 1 finding — `check:schemas` is
  a mandatory pre-commit gate; this is a real contract update, not covered by "no DB migrations").
- No DB migration changes (telemetry is log-line only, per HEL-401's own precedent).
- **Fold-in addendum (post-delivery, before Phase 4 cleanup):** one new regression test covering a
  hop-cap-exhausted turn with MULTIPLE dangling `tool_use` blocks — the already-shipped
  `seedHistory` fix handles this correctly by construction, but no automated test exercised it. No
  production code change expected; test-only, triaged fold-in (see ticket.md Context/Notes).

## Non-goals

- No change to the hop cap value (stays 3) or to `propose_*`'s Hard Boundary.
- No telemetry query API — log-line only, exactly like HEL-401 (no precedent for one exists).
- No retrofit of `searchedWithNoResults`/`hopBudgetExhausted` onto historical turns via `GET` —
  ephemeral, converse-response-only signals by design.
