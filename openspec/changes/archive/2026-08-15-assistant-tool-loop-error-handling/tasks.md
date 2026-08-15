## 1. Backend: tool-execution hardening (design.md D3)

- [x] 1.1 `ClaudeClient.executeTool`: wrap the executor call so a thrown exception or a failed
      inner `Future` (not just an explicit `Left`) recovers to an `isError = true` `ToolResult`,
      logging the recovered failure at `warn` first
- [x] 1.2 Update `claude-api-client`'s spec-covering doc comments in `ClaudeClient.scala`/
      `ClaudeModels.scala` to reflect the widened contract

## 2. Backend: searchedWithNoResults signal (design.md D2)

- [x] 2.1 Add `searchedWithNoResults: Boolean` to `AssistantTurnResult`
      (`AssistantProtocol.scala`)
- [x] 2.2 Compute it in `AssistantService.toTurnResult`/`converse`: `true` iff the outcome is
      `FinalResponse` (no captured proposal) and the last tool call in this turn's new history was
      `find` with an empty result array

## 3. Backend: system-prompt nuance (design.md D4)

- [x] 3.1 Edit `AssistantSystemPrompt.text`'s EXISTING "don't give up, propose anyway" sentence in
      place to become one explicit branch of a single conditional (qualify it with "for goals
      concrete enough to act on"), and add the clarifying-question guidance as its explicit
      else-branch for an underspecified goal — one linked if/else, never two separately-worded,
      unlinked absolute instructions on the same "find returns nothing" trigger

## 4. Backend: surface both signals on the converse response (design.md D1)

- [x] 4.1 Add `hopBudgetExhausted: Option[Boolean]`, `searchedWithNoResults: Option[Boolean]` to
      `AssistantConversationResponse` (`AssistantConversationProtocol.scala`), update
      `jsonFormat5` → `jsonFormat7`
- [x] 4.2 `AssistantConversationRoutes.detailOf`/`converseFlow`: populate both fields only on the
      `POST /:id/converse` path; `GET /:id` leaves them `None`
- [x] 4.3 Update `schemas/assistant-conversation.schema.json` (design.md D7 — design-gate round 1
      finding): add `hopBudgetExhausted`/`searchedWithNoResults` as optional boolean properties
      matching the case class, so `npm run check:schemas` stays green

## 5. Backend: assistant-tool-loop telemetry (design.md D6)

- [x] 5.1 New `AssistantTelemetry.scala` (sibling to `AuthoringTelemetry`, same MDC/
      `MdcPropagatingExecutionContext`/fire-and-forget pattern), `emitToolLoopOutcome` for event
      `assistant_tool_loop_outcome` with `conversationId`, `toolCallCount`, `hopBudgetExhausted`,
      `searchedWithNoResults`, `modelId`, `inputTokens`/`outputTokens` — never the message text
- [x] 5.2 Call it from `AssistantConversationRoutes.converseFlow` on a successful `converse` only
      (never on `Left(claudeError)`), counting `ToolUse` blocks in `result.fullHistory`'s new turns
      for `toolCallCount`

## 6. Frontend: dangling tool_use + turn-outcome treatment (design.md D5)

- [x] 6.1 `ToolCallIndicator.tsx`: render a "cut short" treatment when a `tool_use` block has no
      paired `tool_result`, distinct from any in-progress/completed state
- [x] 6.2 `MessageTurn.tsx`/`ActiveConversationPanel.tsx`: accept explicit `hopBudgetExhausted`/
      `searchedWithNoResults` props for the most recent assistant turn and render a distinct
      treatment for each, driven only by these booleans — never inferred from text content
- [x] 6.3 `assistantConversationsSlice.ts`: capture both new fields from the converse response,
      expose them for the just-completed turn, cleared on the next send

## Tests

- [x] 7.1 `ClaudeClientSpec.scala`: a thrown-exception executor and a failed-Future executor both
      recover to an `isError` tool_result and the loop continues (claude-api-client spec)
- [x] 7.2 `AssistantServiceSpec.scala`: `searchedWithNoResults` is `true` for a zero-result `find`
      + plain final answer, `false` for a non-empty `find` and for a turn with no `find` call
      (assistant-conversation-loop spec)
- [x] 7.3 `AssistantConversationRoutesSpec.scala`: converse response carries `hopBudgetExhausted`/
      `searchedWithNoResults` when true; `GET` never carries either (assistant-live-converse spec)
- [x] 7.4 New `AssistantTelemetrySpec.scala` (mirrors `AuthoringTelemetrySpec.scala`'s
      `JsonLogCapture`/`Eventually` harness): emits on success with correct fields, emits nothing
      on a failed converse call, never logs message text (assistant-tool-loop-telemetry spec)
- [x] 7.5 Frontend: `ToolCallIndicator.test.tsx` covers the cut-short treatment for an unpaired
      `tool_use`; `MessageTurn.test.tsx`/`ActiveConversationPanel.test.tsx` cover both new turn
      treatments and the unaffected-normal-turn case (chat-message-rendering spec)
- [x] 7.6 `npm test` / `npm run lint` / `npm run format:check` / `npm run build` clean;
      `sbt test` clean
