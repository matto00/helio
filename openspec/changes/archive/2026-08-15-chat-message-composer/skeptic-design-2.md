## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all 3 spec deltas
(`specs/assistant-conversation-loop/spec.md`, `specs/assistant-live-converse/spec.md`,
`specs/chat-message-composer/spec.md`) fresh, cold — not from round-1's narrative — and
cross-checked every claim against the real current source in this worktree.

1. **Round-1 Change Request 1 (Failed-outcome `fullHistory`/error signaling) — genuinely fixed, and
   consistent across every artifact.**
   - `backend/src/main/scala/com/helio/ai/ClaudeModels.scala:145,149,153`: confirmed
     `FinalResponse(text, history, usage)` / `HopBudgetExhausted(history, usage)` carry `history`;
     `Failed(error: ClaudeError)` carries none — exactly as design.md D1 states.
   - `backend/src/main/scala/com/helio/services/AssistantService.scala:45-87`: confirmed
     `converse` today returns `Future[AssistantTurnResult]` and `toTurnResult`'s `Failed` branch
     today fabricates a text-only `AssistantTurnResult` — the exact bug D1 fixes.
   - `backend/src/main/scala/com/helio/ai/ClaudeClient.scala:71-118`: confirmed `sendWithTools`
     never fails its `Future` for a transport/API/guardrail error — every such case resolves to a
     "successful" `ClaudeToolOutcome.Failed`, exactly as design.md's D1 justification claims.
   - `proposal.md:10-16`, `design.md:37-55` (D1) + Planner Notes, `tasks.md:1.1/1.2/1.3/6.2a/6.3a`,
     and `specs/assistant-conversation-loop/spec.md`'s two new Requirements (fullHistory +
     "surfaces a real Claude/transport failure as an error, never a fabricated result") all describe
     the identical fix: `Failed` → `Left(error)`, never a value-less/fabricated `AssistantTurnResult`.
     `specs/assistant-live-converse/spec.md`'s "A real Claude/transport failure returns an error and
     persists nothing" Requirement + scenario closes the loop at the route level. No stale reference
     to the old `Future[AssistantTurnResult]` signature or an unhandled `Failed` case remains anywhere
     (`grep -rn "fullHistory\|Future\[AssistantTurnResult\]" openspec/changes/chat-message-composer/`
     — every hit is the new, consistent shape).
   - Re-verified the `ClaudeError → ServiceError` mapping claim against the REAL current
     `DashboardAuthoringService.scala:292-296`: `mapClaudeError` does exist with exactly the claimed
     3-case logic (`ApiError`/`TransportFailure` → `ServiceError.BadGateway(...)`,
     `GuardrailExceeded` → `ServiceError.UnprocessableEntity(...)`) — but it returns `AuthoringError`
     (via `AuthoringError.kinded(kind, ServiceError...)`), not a bare `ServiceError`, because
     `DashboardAuthoringRoutes` uses a bespoke completion helper for its extra `kind` field. Design.md
     D3's phrasing ("the identical 3-case mapping... **already establishes**... kept as a small,
     local duplication here rather than extracting a shared helper") is accurate on a close read: it
     never claims to literally call/reuse `mapClaudeError`'s return value, only the case-by-case
     logic, and it explicitly says the new route builds a local mapping that emits `ServiceError`
     directly (compatible with `ServiceResponse.run`'s existing `Future[Either[ServiceError, A]]` →
     `statusCodeFor`/`completeError` machinery, confirmed by reading
     `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala:26-87` in full). This is
     internally consistent, not a mis-claim.
   - Re-verified `AssistantConversationRoutes.scala`'s real current structure (read the full file):
     constructor is `(service: AssistantConversationService, user: AuthenticatedUser)(implicit
     system)`; 5 existing routes (list/create/get/patch/append). The plan's proposed second
     constructor param (`assistantServiceOpt: Option[AssistantService]`) + one new
     `POST /:id/converse` route is a clean additive fit — no structural conflict. Confirmed
     `AssistantConversationService.get`/`appendTurn`'s real signatures
     (`AssistantConversationService.scala:72-102`) match design.md D3's described flow exactly,
     including that `get`'s `transcript` field is a raw `JsValue` requiring
     `.convertTo[Seq[ClaudeToolMessage]]` — design.md now states this explicitly (round-1's
     non-blocking note), and the `claudeToolMessageFormat`/`claudeContentBlockFormat` implicits
     needed for that conversion are confirmed present and in scope via
     `AssistantConversationRepository`'s companion object.
   - Also re-verified `WorkspaceSearchService`'s real constructor
     (`backend/src/main/scala/com/helio/services/WorkspaceSearchService.scala:31-38`) and
     `AssistantService`'s real constructor
     (`backend/src/main/scala/com/helio/services/AssistantService.scala:31-39`) match design.md D2's
     pseudocode's parameter lists exactly, and that `ApiRoutes.scala`'s existing
     `dashboardAuthoringServiceOpt`/`refinementServiceOpt` gating pattern (lines 298-333) is exactly
     what D2's `assistantServiceOpt` pseudocode mirrors.

2. **Round-1 Change Request 2 (`selectedConversationId` never updated) — genuinely fixed, and
   consistent across every artifact.**
   - `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx:47`: confirmed
     `effectiveId = selectedConversationId ?? items[0]?.id ?? null` is still the real current logic.
   - `frontend/src/features/assistant/state/assistantConversationsSlice.ts:93,132`: confirmed
     `setSelectedConversationId` is a real, existing plain reducer action.
   - `grep -n "setSelectedConversationId" -r frontend/src`: confirmed the only two real dispatch call
     sites are `SidebarBody.tsx:237` and `App.tsx:252`, both explicit user selections — exactly as
     design.md's D5 justification claims ("reused, not reinvented").
   - `design.md:108-123` (D5) + Planner Notes now explicitly add step (2) — dispatch
     `setSelectedConversationId(newId)` between `createConversation()` and `converse(newId, message)`
     — and `tasks.md:5.4` mirrors this exactly, with an explicit note that this is required for
     `effectiveId` to ever pick up the new conversation. `specs/chat-message-composer/spec.md`'s
     "Sending with no conversation selected creates one and sends the message" scenario ("...the
     conversation becomes the active selection...") is now actually satisfiable by this flow.

3. **`openspec validate chat-message-composer --strict`** — ran it myself, fresh, from the worktree
   root: `Change 'chat-message-composer' is valid`.

4. **No placeholders/hand-waving** — `grep -rniE "TODO|TBD|figure out later|to be determined|
   placeholder"` across `ticket.md`/`proposal.md`/`design.md`/`tasks.md`/`specs/` returns nothing.

5. **AC traceability** (`ticket.md`'s 5 ACs against the current plan): AC1 (type + send from both
   entry points) → D5/tasks 5.1-5.3. AC2 (real backend endpoint invoking `converse` + persisting via
   `AssistantConversationService`) → D3/tasks 3.3. AC3 (existing rendering components, no new path) →
   unchanged `ActiveConversationPanel` render tree, D5 places the composer additively. AC4 (empty-state
   user can start by typing) → D5 fix (this round's Change Request 2). AC5 (live Claude round-trip) →
   tasks 6.10, `backend/.env`'s real `ANTHROPIC_API_KEY` confirmed reachable per ticket.md's own
   planning-time note (not independently re-verified by me at this design gate — that's a final-gate
   live-verification concern, not a design-soundness one). All 5 trace to a specific decision/task; no
   AC left uncovered.

6. **Scope discipline** — Impact section lists only the files the change touches; no scope drift
   beyond the ticket's stated boundary (no `AuthoringChatDrawer` retirement, no streaming, explicitly
   called out as Non-Goals and left alone).

### New observation (non-blocking, worth flagging for execution/evaluation)

- **Possible transient double-fetch race in the create-then-converse flow (D5).** Dispatching
  `setSelectedConversationId(newId)` (step 2) changes `effectiveId`, which re-triggers
  `ActiveConversationPanel`'s existing `useEffect` (`ActiveConversationPanel.tsx:49-53`), firing an
  extra `GET /:id` (`selectConversation`) essentially concurrently with the handler's own explicit
  `converse(newId, message)` POST (step 3). In the overwhelmingly likely timing (a local DB+blob GET
  resolving in well under the multi-second Claude round trip the POST is waiting on), this is
  harmless — the GET's near-empty snapshot resolves and gets superseded by the POST's full-transcript
  response shortly after, and no AC is violated. It could theoretically cause a stale overwrite if the
  GET response arrived after the POST's (an inversion that would require the simple GET to take
  longer than the entire Claude call), and it does cause a brief transition through the generic
  "loading" render branch (which has no composer) between the empty-state and success-state views —
  a minor UX flicker, not a correctness bug, and not a new pattern this ticket invents (any existing
  conversation switch already transits the same loading branch). Not required to block this design
  gate — flagging so the evaluator/executor can watch for it during the live-verification pass
  (tasks.md 6.10) rather than being surprised by it.

### Verdict: CONFIRM

Both round-1 change requests are real design changes (not rewording) and are consistent across
`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all 3 spec deltas. Every load-bearing claim
about existing code (`DashboardAuthoringService.mapClaudeError`, `ServiceResponse.statusCodeFor`,
`AssistantConversationRoutes`'s current structure, `WorkspaceSearchService`/`AssistantService`
constructors, `ClaudeToolOutcome`'s shapes, `ActiveConversationPanel`'s selection logic,
`setSelectedConversationId`'s existing call sites) was independently re-verified against the real
current source in this worktree, not taken on faith from the plan's own narrative or round-1's report.
`openspec validate --strict` passes. No placeholders, no internal contradictions, no AC left
uncovered, no scope drift. Sound enough to implement.

### Non-blocking notes

- See the create-then-converse double-fetch observation above — not a required revision, worth a
  glance during live verification.
