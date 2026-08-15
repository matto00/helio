## Context

`AssistantService.converse(history: Seq[ClaudeToolMessage], message: String, user):
Future[AssistantTurnResult]` (HEL-662) has 7 constructor dependencies; 5 (`panelCapabilityService`,
`dashboardProposalService`, `pipelineProposalService`, `combinedProposalService`,
`patchSetPreviewService`) are already live, unconditional vals in `ApiRoutes.scala`.
`WorkspaceSearchService` (HEL-661) has never been constructed anywhere; its own 6th dependency,
`metricService`, only exists as `metricServiceOpt`, gated on a nullable `metricRepo` param
independent of `dbContext`. `AssistantTurnResult` (`text, proposal, toolCallCount,
hopBudgetExhausted, usage`) discards the full turn history `ClaudeToolOutcome.FinalResponse`/
`HopBudgetExhausted` actually carry internally — `toTurnResult` reads it once (to count tool calls)
and drops it. `AssistantConversationService.appendTurn(user, id, turns): Future[Either[ServiceError,
AssistantConversationRecord]]` (HEL-663) returns metadata only, not the updated transcript.
`AssistantConversationRoutes` is mounted in `ApiRoutes.scala` via `assistantConversationServiceOpt
.fold(reject)(...)` — the whole 5-route family is gated on `dbContext` alone (Pattern A).
`DashboardAuthoringRoutes`/`RefinementRoutes` use a different convention (Pattern B): mounted
unconditionally, degrading to a clean `503` per-route when their own `Option[Service]` is `None`,
specifically so a missing `ANTHROPIC_API_KEY` reads as "feature unavailable," not "route doesn't
exist." `backend/.env` in this dev environment has a real `ANTHROPIC_API_KEY` reaching
`ClaudeConfig.fromEnv()` via `loadDotEnv` — a live round trip is genuinely testable here.

## Goals / Non-Goals

**Goals:**
- A real, working send-message flow: type → real `AssistantService.converse` call → real
  `ClaudeClient`/Anthropic round trip → persisted transcript → rendered response.
- Available from both `/chat` and the quick-launcher overlay via the one shared
  `ActiveConversationPanel` — no second composer implementation.
- A first-time user with zero conversations can start one by typing directly.

**Non-Goals:**
- No live streaming (buffered request/response only, matching `converse`'s own signature).
- No `AuthoringChatDrawer` retirement (HEL-666).

## Decisions

**D1 — `AssistantTurnResult` gains `fullHistory: Seq[ClaudeToolMessage]`; `converse` becomes
`Future[Either[ClaudeError, AssistantTurnResult]]` to make the `Failed` outcome representable
(design-gate round 1 fix — the original draft never specified what `fullHistory` should be for
`ClaudeToolOutcome.Failed`, which carries no `history` at all).** Both
`ClaudeToolOutcome.FinalResponse(text, history, usage)` and `HopBudgetExhausted(history, usage)`
already carry the complete turn sequence (the caller-supplied history plus every new turn this call
produced: the user's new message, `tool_use`/`tool_result` blocks, Claude's final text) — these map
to `Right(AssistantTurnResult(..., fullHistory = history))`. `ClaudeToolOutcome.Failed(error:
ClaudeError)` maps to `Left(error)` — mirroring `ClaudeClient.send`'s own existing `Future[Either[
ClaudeError, ClaudeResponse]]` shape exactly, rather than inventing a new error-signaling
convention. `AssistantService.toTurnResult` is changed accordingly. This is the one load-bearing
fix everything else depends on: without a way to distinguish success from failure, a real API error
would either silently discard the user's message (200 OK, no new turns) or get persisted into the
transcript as a fabricated assistant utterance — both violate DESIGN.md §7's binding "never
swallow a failed fetch." Existing HEL-662 tests asserting on the old flat `AssistantTurnResult`
return type need a mechanical update (unwrap the `Right`) — no behavioral change to the success
path, confirmed via `sendWithTools`'s own doc comment that a transport/API/guardrail failure never
produces a failed Scala `Future`, only a "successful" `Failed` outcome, so this was always
representable, just never modeled at the `converse` boundary until now.

**D2 — `WorkspaceSearchService` + `assistantServiceOpt`: new construction in `ApiRoutes.scala`,
gated on `ClaudeConfig.fromEnv()` AND `metricServiceOpt`.** `WorkspaceSearchService`'s other 5
dependencies (`dashboardService`, `dataSourceService`, `dataTypeService`, `pipelineService`,
`workspaceContextService`) are already unconditional vals; only `metricService` requires unwrapping
`metricServiceOpt`. `assistantServiceOpt` construction:
```scala
private val assistantServiceOpt: Option[AssistantService] =
  (ClaudeConfig.fromEnv(), metricServiceOpt) match {
    case (Left(reason), _) => log.warn(s"Assistant converse disabled: $reason"); None
    case (Right(_), None)  => log.warn("Assistant converse disabled: no MetricRepository configured"); None
    case (Right(claudeConfig), Some(metricService)) =>
      val claudeClient = new ClaudeClient(claudeConfig, new HttpClaudeTransport(claudeConfig.apiKey))
      val workspaceSearchService = new WorkspaceSearchService(dashboardService, dataSourceService,
        dataTypeService, pipelineService, metricService, workspaceContextService)
      Some(new AssistantService(claudeClient, workspaceSearchService, panelCapabilityService,
        proposalService, pipelineProposalService, combinedProposalService, patchSetPreviewService))
  }
```
Mirrors `dashboardAuthoringServiceOpt`/`refinementServiceOpt`'s existing "fresh `ClaudeClient` per
service, never shared" convention exactly, with `metricServiceOpt` as the one genuinely new gating
dimension (documented, not silently absorbed).

**D3 — The converse route composes fetch → converse → (on success) append → re-fetch, returning
one `AssistantConversationDetail`; on failure, nothing is persisted and a real error status is
returned (design-gate round 1 fix).** `POST /:id/converse` (in `AssistantConversationRoutes`, which
gains a second constructor param `assistantServiceOpt: Option[AssistantService]`): `None` → `503`
(matches `DashboardAuthoringRoutes`'s exact degrade discipline, independent of whether the rest of
this route family is available); `Some(assistantService)` → `service.get(user, id)` (existing
transcript, `.convertTo[Seq[ClaudeToolMessage]]` from its stored `JsValue`, reusing the identical
conversion idiom `AssistantConversationRoutes.scala` already uses twice for the existing
`messages`/`update` routes) → `assistantService.converse(existing.transcript, message, user)`.
**On `Left(claudeError)`**: map to a `ServiceError` via a small, local mapping (`ApiError`/
`TransportFailure` → `ServiceError.BadGateway`, `GuardrailExceeded` → `ServiceError
.UnprocessableEntity` — the identical 3-case mapping `DashboardAuthoringService.mapClaudeError`
already establishes; kept as a small, local duplication here rather than extracting a shared helper
out of already-shipped HEL-401 code, an unrelated refactor this ticket doesn't need), complete with
`ServiceResponse`'s existing `statusCodeFor`/`completeError` machinery, and **persist nothing** —
the user's message is never silently discarded (route fails visibly) nor fabricated into the
transcript as a "response." **On `Right(result)`**: `result.fullHistory.drop(existing.transcript
.length)` (the new turns only, per D1) → `service.appendTurn(user, id, newTurns)` →
`service.get(user, id)` again (the refreshed detail, never hand-spliced client-side) → that
response. Two `get` calls on the success path, not one — chosen over splicing `newTurns` onto the
already-held `existing` value locally, because the persisted row's own `updatedAt`/`title` (title
derivation can still apply on subsequent messages) should always be the source of truth returned to
the caller, not a client-reconstructed approximation.

**D4 — `AssistantConversationRoutes`'s other 5 routes are unaffected — the `dbContext` gate (Pattern
A) stays exactly as HEL-663 built it.** Only the new converse route additionally checks
`assistantServiceOpt`; list/create/get/append/pin never touch `AssistantService` and keep working
identically whether or not `ANTHROPIC_API_KEY`/`metricServiceOpt` are configured.

**D5 — `MessageComposer` renders inside `ActiveConversationPanel`, including the empty-conversation
case; sending with no conversation selected creates one first, explicitly selects it, then converses
against it — one code path, not two (design-gate round 1 fix: the original draft never updated
`selectedConversationId`, so `ActiveConversationPanel`'s own `effectiveId = selectedConversationId
?? items[0]?.id ?? null` would have stayed `null` forever after a "successful" send, leaving the
panel stuck on the empty-state branch — confirmed by reading the component's real current logic).**
Placed as the last child of `ActiveConversationPanel`'s success-state render tree (after the
transcript/`ProposalHandoff`), and also rendered alongside the existing `EmptyState` when
`effectiveId === null` — a first-time user isn't blocked behind a separate, unreachable
"create conversation" affordance. The send handler, when no conversation is currently selected: (1)
`createConversation()` (HEL-663, no `firstMessage` — an empty "New conversation") → (2) dispatch the
existing `setSelectedConversationId(newId)` plain reducer action (already used identically by
`SidebarBody.tsx`/`App.tsx`'s own explicit-selection call sites — reused, not reinvented) → (3)
`converse(newId, message)` against it — the exact same converse call an existing conversation's send
uses, never a second, divergent "first message" code path. `EmptyState`'s own existing visual
(icon/title/description) is unchanged; the composer is additive alongside it, not a replacement.

**D6 — No streaming.** `converse` is a single buffered request/response (matches
`AssistantService.converse`'s own signature — it has no streaming variant). The composer shows a
loading/sending indicator (reusing the established spinner pattern, per DESIGN.md §7) for the
duration of the request; `StreamingText` (HEL-665's first pass) remains unwired, as originally
scoped — building a live SSE variant of `converse` is separate, larger, unrequested scope.

**D7 — New wire types in `AssistantConversationProtocol.scala`**: `ConverseRequest(message: String)`,
reusing the existing `AssistantConversationResponse` shape for the return value (no new response
type needed — the converse endpoint returns exactly what `GET /:id` already returns).

## Risks / Trade-offs

- **Two DB round trips per converse call (D3)** → acceptable: correctness (always returning the
  real persisted state) over a minor latency cost on a user-initiated, already-network-bound action
  (the Claude call itself dominates latency regardless).
- **New `metricServiceOpt` gating dimension (D2)** → a real, disclosed constraint: if
  `metricRepo` is ever null in a given deployment, the entire live-converse feature silently
  degrades to 503 alongside authoring/refinement, not a surprise specific to this ticket — matches
  existing precedent for how this codebase already handles partial-dependency environments.
- **No streaming (D6)** → acceptable per explicit Non-Goal; a real UX cost (no incremental feedback
  during a possibly-multi-hop `converse` call) mitigated by a clear loading/sending indicator.
- **`ClaudeError` → `ServiceError` mapping duplicated locally rather than extracted into a shared
  helper (D3)** → accepted as a small, deliberate duplication (3 cases) rather than refactoring
  already-shipped, already-tested `DashboardAuthoringService.mapClaudeError` (HEL-401) to expose a
  shared version — extracting it is a reasonable future DRY opportunity once a third consumer needs
  the identical mapping, not before; not touching unrelated, already-merged code for this ticket's
  own sake.

## Planner Notes

- Self-approved: fetch → converse → append → re-fetch (D3) over a single-round-trip
  compute-then-return — favors correctness/consistency with the persisted row over a minor
  performance optimization, matching this codebase's general preference (seen throughout this
  epic) for re-deriving from the source of truth rather than trusting a locally-reconstructed value.
- Self-approved: composer renders in the empty-conversation-list state too (D5) — directly required
  by AC4 ("a user with no existing conversations can start one by typing directly"), and the
  create-then-converse flow reuses one code path rather than inventing a parallel "first message"
  mechanism.
- Self-approved (design-gate round 1 fix): `converse` returns `Future[Either[ClaudeError,
  AssistantTurnResult]]` rather than leaving `AssistantTurnResult.fullHistory` underspecified for
  the `Failed` case — mirrors `ClaudeClient.send`'s own existing `Either` shape exactly, the
  smallest change consistent with an existing, already-established convention rather than a novel
  error-signaling mechanism.
- Self-approved (design-gate round 1 fix): explicit `setSelectedConversationId(newId)` dispatch in
  the create-then-converse flow (D5) — required for `ActiveConversationPanel`'s existing
  `effectiveId` derivation to ever pick up a freshly created conversation; reuses the existing
  action other call sites already dispatch identically, not a new selection mechanism.
