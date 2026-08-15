## Backend

- `backend/src/main/scala/com/helio/api/protocols/AssistantProtocol.scala` — `AssistantTurnResult`
  gains `fullHistory: Seq[ClaudeToolMessage]` (task 1.1).
- `backend/src/main/scala/com/helio/services/AssistantService.scala` — `converse`'s return type
  changes to `Future[Either[ClaudeError, AssistantTurnResult]]`; `Failed` outcome now maps to
  `Left(error)` instead of a fabricated `AssistantTurnResult` (tasks 1.2).
- `backend/src/test/scala/com/helio/services/AssistantServiceSpec.scala` — existing tests unwrap
  `Right`; new tests cover `fullHistory` for `FinalResponse`/`HopBudgetExhausted` and `Left` for
  `Failed` (tasks 1.3, 6.1, 6.2, 6.2a).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — first construction of
  `WorkspaceSearchService`; new `assistantServiceOpt`, gated on `ClaudeConfig.fromEnv()` AND
  `metricServiceOpt`; wired into `AssistantConversationRoutes`'s constructor (tasks 2.1, 2.2, 3.4).
- `backend/src/main/scala/com/helio/api/protocols/AssistantConversationProtocol.scala` — new
  `ConverseRequest(message: String)` wire type + formatter (task 3.1).
- `backend/src/main/scala/com/helio/api/routes/AssistantConversationRoutes.scala` — new
  `assistantServiceOpt` constructor param; new `POST /:id/converse` route (fetch → converse →
  append → re-fetch on success; mapped error + no persistence on `Left`; `503` when unavailable)
  (tasks 3.2, 3.3).
- `backend/src/test/scala/com/helio/api/routes/AssistantConversationRoutesSpec.scala` (new) —
  route-level HTTP-shell coverage: persist-on-success, mapped-error-and-no-persist-on-failure, 503
  degrade, and real-RLS cross-user isolation (dual-pool `helio_app_test` harness) (tasks 6.3, 6.3a,
  6.4, 6.5).

## Frontend

- `frontend/src/features/assistant/services/assistantConversationsService.ts` — new `converse(id,
  message)` calling `POST /:id/converse` (task 4.1).
- `frontend/src/features/assistant/services/assistantConversationsService.test.ts` — test for the
  new `converse` function.
- `frontend/src/features/assistant/state/assistantConversationsSlice.ts` — new `converse` thunk;
  `fulfilled` replaces `activeConversation.data` wholesale (mirrors `selectConversation.fulfilled`);
  `pending`/`rejected` deliberately NOT wired into `activeConversation.status` so the composer's own
  local sending/error state (not a full-panel swap) surfaces send-in-flight/failure (task 4.2).
- `frontend/src/features/assistant/state/assistantConversationsSlice.test.ts` — tests for the new
  thunk/reducer wiring.
- `frontend/src/features/assistant/ui/MessageComposer.tsx` (new) + `MessageComposer.css` (new) —
  the real text-input + send composer: local sending/error state, DESIGN.md §7-compliant loading
  indicator and error styling, create-then-converse flow for the no-conversation-selected case
  (explicit `setSelectedConversationId` dispatch — design-gate round-1 fix) (tasks 5.1, 5.4, 5.5).
- `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx` — renders `MessageComposer` as
  the last child of the success-state tree and alongside `EmptyState` in the no-selection case
  (tasks 5.2, 5.3).
- `frontend/src/features/assistant/ui/ActiveConversationPanel.css` — layout rule for the
  empty-state + composer wrapper.
- `frontend/src/features/assistant/ui/ActiveConversationPanel.test.tsx` — new scenario tests: new
  turns render via `MessageTurn` after an existing-conversation send, create-then-converse from the
  empty state becomes the active selection, and a failed send shows a visible error while preserving
  the typed input (tasks 6.7, 6.8, 6.9).
- `frontend/src/features/assistant/ui/ChatPage.test.tsx` — asserts the composer renders on `/chat`
  via the shared `ActiveConversationPanel` (task 6.6).
- `frontend/src/features/assistant/ui/QuickLauncherOverlay.test.tsx` (new) — asserts the same
  composer renders inside the quick-launcher overlay when open, and is absent when closed (task
  6.6).

## API contract

- `schemas/converse-request.schema.json` (new) — JSON Schema mirror of `ConverseRequest`, matching
  this route family's existing 1:1 schema-per-request-type convention.

## Live verification (AC5 / task 6.10)

- `e2e/hel665-message-composer.spec.ts` (new) — Playwright spec run against the real dev servers
  (`DEV_PORT=6097`, `BACKEND_PORT=9004`) with the real `ANTHROPIC_API_KEY`: registers a fresh user,
  types a message on `/chat`'s empty state, sends it, and asserts a real 200 response with a real
  Claude reply rendering via `MessageTurn`. Passed (see final report for full evidence, including a
  standalone curl-based round trip confirming persistence via a subsequent `GET`).

## Cycle 2 — evaluation-1.md Change Request 1 fix (live-verified blocking defect)

- **Root cause**: `AssistantService.seedHistory` folds `AssistantSystemPrompt.text + "\n\n" +
  message` into the SAME `ClaudeToolMessage` used as a brand-new conversation's first turn (empty
  caller-supplied `history`) — pre-existing HEL-662 behavior, safe until this ticket first threaded
  that literal seeded turn through `AssistantTurnResult.fullHistory` into persistence (`appendTurn`)
  and rendering (`MessageTurn.tsx`) verbatim.
- `backend/src/main/scala/com/helio/services/AssistantService.scala` — `converse` now captures
  `historyWasEmpty` from the CALLER-supplied `history` (before `seedHistory` folds the system
  prompt in) and threads it + the original `message` into `toTurnResult`; new private
  `desanitizeFirstTurn` rewrites `fullHistory`'s first turn back down to the plain `message` when
  `historyWasEmpty` is true. The OUTBOUND `ClaudeToolRequest` (what Claude actually receives) is
  completely unaffected — only the RETURNED/persisted/rendered value changes.
- `backend/src/test/scala/com/helio/services/AssistantServiceSpec.scala` — `FakeToolTransport` gains
  request-capture (`firstReceivedRequest`) so a test can assert the outbound request still carries
  the system prompt; new dedicated regression test asserts `fullHistory.head.content` is exactly
  `Seq(ClaudeContentBlock.Text(message))` for an empty-history call, AND that the outbound request
  is unaffected. The existing task-6.1 test also now asserts the first turn's exact content.
- `backend/src/test/scala/com/helio/api/routes/AssistantConversationRoutesSpec.scala` — new
  dedicated test asserting the PERSISTED first turn's content (not just transcript size) for a
  brand-new (empty-history) conversation is exactly the typed message.
- `e2e/hel665-message-composer.spec.ts` — strengthened from `getByText` (substring match — would
  have passed even with the defect present, since the polluted text contains the typed message as a
  trailing substring) to an exact `toHaveText` match on the "You" bubble, plus a direct assertion on
  the API response body's persisted first-turn text.
- All 3 new/strengthened tests confirmed to fail before the fix (via `git stash` isolating just the
  `AssistantService.scala` fix) and pass after — see final report for pasted evidence.
- Live-verified again against the real Anthropic API (backend dev server restarted to pick up the
  fix): a genuinely fresh user's first message now persists and renders exactly as typed, confirmed
  via curl (`GET` after `POST /converse`) and the strengthened Playwright e2e spec.
