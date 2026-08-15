## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **`AssistantTurnResult` / `ClaudeToolOutcome` current shape** — read
   `backend/src/main/scala/com/helio/api/protocols/AssistantProtocol.scala:23-29` (no `fullHistory`
   field today) and `backend/src/main/scala/com/helio/ai/ClaudeModels.scala:145,149` (`FinalResponse`
   and `HopBudgetExhausted` genuinely carry `history: Seq[ClaudeToolMessage]`). Confirmed
   `AssistantService.toTurnResult`
   (`backend/src/main/scala/com/helio/services/AssistantService.scala:74-87`) currently reads
   `fullHistory` only to compute `toolCallCount` and discards it. Matches the plan's claim exactly.

2. **`ApiRoutes.scala` current dependency wiring** — confirmed via grep + read
   (`backend/src/main/scala/com/helio/api/ApiRoutes.scala:142-333`): `panelCapabilityService` (158),
   `proposalService`/dashboardProposalService (145), `pipelineProposalService` (185),
   `combinedProposalService` (193), `patchSetPreviewService` (214) are all unconditional vals;
   `workspaceContextService` (285) is also unconditional. `grep -rn "new WorkspaceSearchService"` across
   `backend/src/main/scala/` returns zero hits — genuinely never constructed. `metricServiceOpt` (263)
   is `Option(metricRepo).map(...)`, independent of `dbContext` — confirmed. The
   `dashboardAuthoringServiceOpt`/`refinementServiceOpt` pattern (298-333) the plan says D2 mirrors is
   read verbatim and matches the plan's pseudocode structurally.

3. **`AssistantConversationService` current signatures** — read
   `backend/src/main/scala/com/helio/services/AssistantConversationService.scala`: `appendTurn`
   returns `Future[Either[ServiceError, AssistantConversationRecord]]` (72-89, metadata only, matches
   the plan's claim). `get` returns `Future[Either[ServiceError, AssistantConversationDetail]]` where
   `AssistantConversationDetail(record, transcript: JsValue)` (95-102, 203) — `transcript` is a raw
   `JsValue`, not `Seq[ClaudeToolMessage]` (see Change Request 3). `ClaudeToolMessage`/
   `ClaudeContentBlock` are the same `com.helio.ai` types both `AssistantService.converse` and
   `AssistantConversationService.appendTurn` already import — no adapter needed, confirmed.

4. **`AssistantConversationRoutes.scala` current state** — read the full file. Mounted via
   `assistantConversationServiceOpt.fold(reject: Route)(...)` at `ApiRoutes.scala:497` (Pattern A,
   confirmed). The route file already establishes the `JsValue <-> ClaudeToolMessage` conversion
   idiom at lines 74 and 85 (`.convertTo[ClaudeToolMessage]`), importing
   `com.helio.infrastructure.AssistantConversationRepository._`. The plan's proposed second
   constructor param + one new route is a clean additive fit against this file's existing structure.

5. **`ActiveConversationPanel.tsx` current render tree** — read the full file (132 lines): early
   return for `effectiveId === null` → `EmptyState`; error state; loading state; success state ending
   in `transcript` map + `{proposalExtraction && <ProposalHandoff .../>}`. Matches design.md D5's
   description of where `MessageComposer` is planned to go exactly.

6. **`openspec validate chat-message-composer --strict`** — ran it myself from the worktree root:
   `Change 'chat-message-composer' is valid`.

7. **Canonical epic spec** (`docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`) and
   `DESIGN.md` §7 read in full. DESIGN.md §7 is binding and explicit: "Error: visible, human-readable,
   intent-error styled — **never swallow a failed fetch.**" This directly bears on Change Request 1
   below.

### Verdict: REFUTE

Two load-bearing gaps would either block a literal implementation of tasks.md or silently violate a
binding design standard / stated AC. Both are grounded in the real current source, not speculation.

### Change Requests

1. **The plan never specifies what happens on `ClaudeToolOutcome.Failed` — and as scoped, this either
   won't compile or will silently discard the user's message on a real Claude/transport failure,
   violating DESIGN.md §7 ("never swallow a failed fetch") and tasks.md 6.9's "not a silent failure."**
   - `ClaudeToolOutcome.Failed(error: ClaudeError)` (`ClaudeModels.scala:153`) carries **no** `history`
     field at all — unlike `FinalResponse`/`HopBudgetExhausted`. `AssistantService.scala:85-86`
     constructs `AssistantTurnResult` in this branch today with no history-derived data available.
     Tasks.md 1.2 only says to thread `fullHistory` through "from both `ClaudeToolOutcome.FinalResponse`
     and `HopBudgetExhausted`" — once `fullHistory: Seq[ClaudeToolMessage]` becomes a required
     (non-`Option`) field on `AssistantTurnResult` (per spec.md's `assistant-conversation-loop`
     requirement), the `Failed` branch **must** also supply a value, and design.md never says what it
     should be. `toTurnResult` doesn't even receive `history` as a parameter today — supplying a
     sensible value (e.g., threading `history`/`seedHistory(history, message)` through) is a design
     decision, not an implementation detail, because:
   - Whatever value is chosen for `fullHistory` in the `Failed` case directly determines what
     `POST /:id/converse`'s D3 flow (`result.fullHistory.drop(existing.transcript.length)` →
     `service.appendTurn(...)`) does on a real API failure. If it resolves to an empty/no-new-turns
     slice, the route will silently discard the user's typed message and still return **200 OK** with
     an unchanged transcript — no error surfaced anywhere, no message even preserved for retry. If
     instead the plan intends the `Failed` outcome's error text ("Assistant request failed: ...") to be
     persisted and rendered as if it were a real Claude response, that blurs an infrastructure failure
     into the transcript as a fabricated assistant utterance — also undesirable, and also not what
     tasks.md 6.9 ("surfaces a visible error... not a silent failure") implies.
   - Nothing in `AssistantConversationResponse` (D7's chosen return shape: id/title/pinned/updatedAt/
     transcript) or the route's D3 flow gives the frontend any signal to distinguish "Claude call
     failed" from "Claude answered normally" — the route always returns 200. `AssistantService.converse`
     itself (`sendWithTools`, confirmed in `ClaudeClient.scala:71-90`) never produces a failed Scala
     `Future` for a transport/API/guardrail failure — every such failure is folded into a "successful"
     `ClaudeToolOutcome.Failed`, so this can't be caught downstream by accident.
   - **Required revision**: design.md needs an explicit decision for this case — e.g., have the route
     pattern-match the raw `ClaudeToolOutcome` (not just the folded `AssistantTurnResult`) and complete
     a real HTTP error status (502/503, matching `DashboardAuthoringRoutes`'s existing
     `Either[AuthoringError, A]` → `ServiceResponse.statusCodeFor` precedent in
     `backend/src/main/scala/com/helio/api/routes/DashboardAuthoringRoutes.scala`) without persisting
     anything, OR add an explicit success/failure signal to `AssistantTurnResult`/the wire response that
     the frontend can act on. Tasks.md also needs a test for this branch (6.1-6.3 only cover
     `FinalResponse`/`HopBudgetExhausted`/happy-path persistence).

2. **D5's "create then converse" flow never updates `selectedConversationId` (or `items`), so
   `ActiveConversationPanel` cannot actually surface the newly created conversation — contradicting AC4
   and the `chat-message-composer` spec's own scenario.**
   - `ActiveConversationPanel.tsx:47` computes `effectiveId = selectedConversationId ?? items[0]?.id ??
     null`. Confirmed via full-repo grep that `createConversation` (the service function,
     `assistantConversationsService.ts:31`) has **no existing thunk or caller anywhere** in the
     codebase today — this ticket is the first real caller. `setSelectedConversationId` (the existing
     action, `assistantConversationsSlice.ts:93/132`) is dispatched today only by `SidebarBody.tsx:237`
     and `App.tsx:252` — both explicit, user-driven selections.
   - Design.md D5 / tasks.md 5.4 describe the send handler as: "if no conversation is currently
     selected, call `createConversation()` ... then immediately call `converse(newId, message)`" — with
     no mention of updating `selectedConversationId` or `items`. Neither the `converse` thunk (task 4.2,
     which per D3 only "replaces `activeConversation.data`... mirrors `selectConversation.fulfilled`'s
     existing update shape") nor `createConversation` itself touches `selectedConversationId`. Neither
     `ChatPage.tsx` nor `QuickLauncherOverlay.tsx` re-fetch `items` except on mount/open (confirmed by
     reading both files in full).
   - As a result: after a successful create+converse, `selectedConversationId` stays `null` and `items`
     stays `[]` (no refetch triggered) — so `effectiveId` stays `null` forever, and
     `ActiveConversationPanel` keeps rendering the `effectiveId === null` branch
     (`EmptyState` + composer), never the success-state tree with the transcript. This directly
     contradicts AC4 ("...not blocked behind a separate...step") and the `chat-message-composer` spec's
     scenario ("...the conversation becomes the active selection, showing the sent message and its
     response").
   - **Required revision**: design.md D5 / tasks.md 5.4 must explicitly add a step — dispatch
     `setSelectedConversationId(newId)` as part of the send handler immediately after
     `createConversation()` resolves (before or alongside the `converse(newId, message)` call) — so
     `effectiveId` actually picks up the new conversation.

### Non-blocking notes

- D3's phrasing ("`assistantService.converse(existing.transcript, message, user)`" /
  "`result.fullHistory.drop(existing.transcript.length)`") glosses over that `existing.transcript`
  (from `AssistantConversationService.get`) is a raw `JsValue`, not `Seq[ClaudeToolMessage]` — it needs
  a `.convertTo[Seq[ClaudeToolMessage]]` first. This is trivial given the identical
  `JsValue <-> ClaudeToolMessage` idiom `AssistantConversationRoutes.scala` already uses twice (lines
  74, 85), but worth a one-line clarification in design.md so an implementer doesn't have to
  rediscover the pattern.
- After Change Request 2 is fixed, consider whether the sidebar's `items` list should also be updated
  (or refetched) so a freshly created conversation shows up in `SidebarBody.tsx`'s list without
  requiring navigation — not required by any stated AC/spec scenario, but likely expected UX polish.
