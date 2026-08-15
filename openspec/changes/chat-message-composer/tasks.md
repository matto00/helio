## 1. Backend: AssistantTurnResult + converse signature fix

- [x] 1.1 Add `fullHistory: Seq[ClaudeToolMessage]` to `AssistantTurnResult`
      (`AssistantProtocol.scala`)
- [x] 1.2 Change `AssistantService.converse`'s return type to `Future[Either[ClaudeError,
      AssistantTurnResult]]` (design.md D1): `ClaudeToolOutcome.FinalResponse`/`HopBudgetExhausted`
      → `Right(AssistantTurnResult(..., fullHistory = history))`; `ClaudeToolOutcome.Failed(error)`
      → `Left(error)` — never a value-less/fabricated `fullHistory`
- [x] 1.3 Update `AssistantServiceSpec`'s existing tests (HEL-662) for the new `Either`-wrapped
      return type — mechanical unwrap of `Right`, no behavioral change to any already-passing
      success-path assertion

## 2. Backend: Wire AssistantService into ApiRoutes

- [x] 2.1 Construct `WorkspaceSearchService` in `ApiRoutes.scala` (new — first construction site),
      unwrapping `metricServiceOpt` for its 6th dependency
- [x] 2.2 Add `assistantServiceOpt: Option[AssistantService]`, gated on `ClaudeConfig.fromEnv()`
      AND `metricServiceOpt`, constructing a fresh `ClaudeClient` (never shared, mirrors
      `dashboardAuthoringServiceOpt`/`refinementServiceOpt`) plus the new `WorkspaceSearchService`
      and the 5 already-live proposal/capability services (design.md D2)

## 3. Backend: Converse route

- [x] 3.1 Add `ConverseRequest(message: String)` to `AssistantConversationProtocol.scala` (design.md
      D7) — reuse the existing `AssistantConversationResponse` shape for the return value, no new
      response type
- [x] 3.2 Add a second constructor param `assistantServiceOpt: Option[AssistantService]` to
      `AssistantConversationRoutes`
- [x] 3.3 Implement `POST /:id/converse` (design.md D3): `None` → `503`; `Some` → `service.get`
      (existing transcript, `.convertTo[Seq[ClaudeToolMessage]]`) →
      `assistantService.converse(existing.transcript, message, user)` → on `Left(claudeError)`: map
      to `ServiceError` via a small local mapping (`ApiError`/`TransportFailure` → `BadGateway`,
      `GuardrailExceeded` → `UnprocessableEntity` — mirrors `DashboardAuthoringService
      .mapClaudeError`'s existing 3-case logic), complete via `ServiceResponse`'s existing
      `statusCodeFor`/`completeError`, persist NOTHING; on `Right(result)`:
      `result.fullHistory.drop(existing.transcript.length)` (new turns only) →
      `service.appendTurn(user, id, newTurns)` → `service.get` again (refreshed detail) → return it
      — the other 5 routes' `dbContext`-only gate (Pattern A) is unaffected (design.md D4)
- [x] 3.4 Pass `assistantServiceOpt` into `AssistantConversationRoutes`'s construction in
      `ApiRoutes.scala`, alongside the existing `assistantConversationServiceOpt`

## 4. Frontend: Service + slice

- [x] 4.1 Add `converse(id, message)` to `assistantConversationsService.ts`
      (`POST /:id/converse` → `AssistantConversationDetail`)
- [x] 4.2 Add a `converse` thunk to `assistantConversationsSlice.ts`: on fulfillment, replace
      `activeConversation.data` with the response (mirrors `selectConversation.fulfilled`'s
      existing update shape, design.md D3) — no follow-up `getConversation` call needed

## 5. Frontend: MessageComposer

- [x] 5.1 Add `frontend/src/features/assistant/ui/MessageComposer.tsx` + `.css`: a text input +
      send button/action, DESIGN.md-token-based, with a sending/loading indicator for the duration
      of the request (design.md D6 — reuse the established spinner pattern)
- [x] 5.2 Render `MessageComposer` as the last child of `ActiveConversationPanel`'s success-state
      tree (after the transcript/`ProposalHandoff`)
- [x] 5.3 Also render `MessageComposer` alongside the existing `EmptyState` in the
      no-conversation-selected case — `EmptyState`'s own visual is unchanged, the composer is
      additive (design.md D5)
- [x] 5.4 Implement the send handler: if no conversation is currently selected — (1)
      `createConversation()` (no `firstMessage`) to get a real id, (2) dispatch the existing
      `setSelectedConversationId(newId)` action (required — without it `effectiveId` never picks up
      the new conversation, design-gate round 1 fix), (3) `converse(newId, message)` against it —
      one code path, not a separate "first message" mechanism (design.md D5)
- [x] 5.5 Clear the composer's input and show the sending indicator while the request is in flight;
      surface a visible error (DESIGN.md §7 intent-error styling) on failure, never a silent drop

## Tests

- [x] 6.1 Test: `AssistantService.converse`'s `FinalResponse` outcome yields
      `Right(AssistantTurnResult(...))` whose `fullHistory` includes the new user turn and Claude's
      final response, in order
- [x] 6.2 Test: the `HopBudgetExhausted` outcome also yields `Right(...)` with `fullHistory`
      populated (not empty/partial)
- [x] 6.2a Test: the `ClaudeToolOutcome.Failed` outcome yields `Left(claudeError)`, not a value-less
      or fabricated `AssistantTurnResult` (design-gate round 1 fix)
- [x] 6.3 Test: `POST /:id/converse` persists the new turns on success (a subsequent `GET` returns
      the identical transcript) — fake `ClaudeTransport`/scripted `ClaudeToolOutcome`, no real
      network call in this test
- [x] 6.3a Test: `POST /:id/converse` on a `Left(claudeError)` outcome returns the mapped error
      status (e.g. `BadGateway` for `ApiError`/`TransportFailure`, `UnprocessableEntity` for
      `GuardrailExceeded`) AND persists nothing — a subsequent `GET` shows the transcript unchanged
      from before the failed send (design-gate round 1 fix)
- [x] 6.4 Test: `POST /:id/converse` returns `503` when `assistantServiceOpt` is `None`, while
      `GET /api/assistant-conversations` still works normally
- [x] 6.5 Test: a second user cannot converse with the first user's conversation (not-found result,
      no turns persisted) — real non-superuser RLS role, mirroring HEL-663's established convention
- [x] 6.6 Test: the composer is present and functionally identical on both `/chat` and the
      quick-launcher overlay (one shared `ActiveConversationPanel`, not two composers)
- [x] 6.7 Test: sending a message renders the new turns via the existing `MessageTurn`/
      `ToolCallIndicator` components — same visual treatment as a pre-existing turn
- [x] 6.8 Test: sending with no conversation selected creates one and the new conversation becomes
      the active selection, showing the sent message and its response
- [x] 6.9 Test: a failed `converse` call surfaces a visible error in the composer, not a silent
      failure, and does not clear the user's typed input (so they can retry without retyping)
- [x] 6.10 Live verification (AC5, run manually/via the evaluator's Playwright pass against the
      real dev backend, real `ANTHROPIC_API_KEY`): a real typed message actually reaches
      `AssistantService.converse` → `ClaudeClient` → the real Anthropic API and the response
      renders correctly — this is explicitly NOT a fake-transport test, confirm it against the
      live running app. Also sanity-check the create-then-converse flow (design.md D5) for a benign
      near-concurrency: the fresh conversation's own effect-driven `GET /:id` and the explicit
      `converse` `POST` fire close together (design-gate round 2 non-blocking note) — harmless in
      virtually all real timings since the `GET` resolves well before the Claude round trip
      completes, but confirm live rather than assuming
- [x] 6.11 `sbt test` and `npm test` fully green; `npm run lint`/`npm run format:check` clean
