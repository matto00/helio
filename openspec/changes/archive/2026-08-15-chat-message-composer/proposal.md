## Why

HEL-665 shipped real message-rendering UI but no way to actually send a message — the composer half
of its own stated scope. This also means `AssistantService.converse` (HEL-662) has still never been
wired to a live route, and `AssistantConversationService` (HEL-663) has never had a real send flow
to exercise. Closing this gap requires real backend route wiring, not just a frontend component.

## What Changes

- Extend `AssistantTurnResult` (HEL-662) to also carry `fullHistory: Seq[ClaudeToolMessage]`, and
  change `AssistantService.converse`'s return type to `Future[Either[ClaudeError,
  AssistantTurnResult]]` — mirrors `ClaudeClient.send`'s own existing `Either` shape, and is the
  only way to represent `ClaudeToolOutcome.Failed` (which carries no history at all) without either
  silently discarding the user's message or fabricating a persisted "response" for a real API
  failure. Existing HEL-662 tests need a mechanical update (unwrap `Right`); no behavioral change
  to the success path.
- Construct `WorkspaceSearchService` (HEL-661) for the first time in `ApiRoutes.scala`, and a new
  `assistantServiceOpt: Option[AssistantService]`, gated on `ClaudeConfig.fromEnv()` **and**
  `metricServiceOpt` (transitively required by `WorkspaceSearchService`) — mirroring
  `dashboardAuthoringServiceOpt`/`refinementServiceOpt`'s existing gating pattern, with one new
  gating dimension (`metricServiceOpt`) neither of those needs.
- Add `POST /api/assistant-conversations/:id/converse` to `AssistantConversationRoutes`: fetches
  the conversation's existing transcript, calls `AssistantService.converse`, and — only on success
  — appends the delta turns via the existing `appendTurn` and returns the refreshed
  `AssistantConversationDetail` in one response. On a real Claude/transport failure, nothing is
  persisted and a real error status is returned (mapped from `ClaudeError`, reusing the same
  3-case mapping `DashboardAuthoringService.mapClaudeError` already establishes) — never a silent
  200 with a discarded message. Degrades to `503` when `assistantServiceOpt` is `None` (same "clean
  503, not a confusing 404" discipline `DashboardAuthoringRoutes` already established), independent
  of whether the rest of the route family (persistence-only) is available.
- Add `MessageComposer.tsx`: a real text input + send button, rendered inside
  `ActiveConversationPanel` (both `/chat` and the quick-launcher overlay automatically get it, since
  both already render this one shared component) — including the empty-conversation-list case, so a
  first-time user isn't blocked behind a separate, unreachable "create conversation" step.
- Add a `converse` thunk + service function on the frontend, updating `activeConversation.data`
  in-place from the route's single-round-trip response — no follow-up `getConversation` needed.

## Capabilities

### New Capabilities

- `assistant-live-converse`: the live backend route wiring `AssistantService.converse` to real
  conversation persistence for the first time.
- `chat-message-composer`: the frontend text-input + send affordance, available from both chat
  entry points via the shared `ActiveConversationPanel`.

### Modified Capabilities

- `assistant-conversation-loop` (HEL-662): `AssistantTurnResult` gains `fullHistory`, so a caller
  can actually persist what `converse` produced.

## Impact

- `backend/src/main/scala/com/helio/services/AssistantService.scala`,
  `backend/src/main/scala/com/helio/api/protocols/AssistantProtocol.scala`: `AssistantTurnResult`
  gains `fullHistory`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala`: new `WorkspaceSearchService`
  construction, new `assistantServiceOpt`, passed into `AssistantConversationRoutes`'s constructor.
- `backend/src/main/scala/com/helio/api/routes/AssistantConversationRoutes.scala`: new constructor
  param (`Option[AssistantService]`), new `POST /:id/converse` route.
- `backend/src/main/scala/com/helio/api/protocols/AssistantConversationProtocol.scala`: new
  request/response wire types for the converse endpoint.
- `frontend/src/features/assistant/`: new `ui/MessageComposer.tsx` + `.css`; `services/
  assistantConversationsService.ts` gains a `converse` function; `state/
  assistantConversationsSlice.ts` gains a `converse` thunk; `ui/ActiveConversationPanel.tsx` renders
  the composer.
- No changes to `ChatPage.tsx`, `SidebarBody.tsx`, `QuickLauncherOverlay.tsx` — both entry points
  inherit the composer automatically via the shared `ActiveConversationPanel`.

## Non-goals

- No streaming wiring for this live route (`StreamingText` remains unwired — the converse call is a
  single buffered request/response, matching `AssistantService.converse`'s own buffered signature;
  live SSE streaming for the assistant, if ever built, is separate, larger scope not requested here).
- No retirement of `AuthoringChatDrawer` (HEL-666, still held pending this ticket + a human look).
