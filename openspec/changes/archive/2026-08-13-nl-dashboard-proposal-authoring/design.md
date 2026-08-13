## Context

`DashboardProposalService.apply` (`backend/src/main/scala/com/helio/services/DashboardProposalService.scala`)
already validates a `DashboardProposal` via private `validateStructure` + `ProposalPanelSupport.
preValidateBindings`, then creates it — no standalone "validate only" entry point exists.
`WorkspaceContextService.assemble(user, budgetBytes): Future[WorkspaceContextResponse]` (HEL-371)
assembles data sources/types/pipelines/dashboards but never panel capabilities.
`PanelCapabilityService.getCapabilities(id, user): Future[Either[ServiceError, PanelCapabilitiesResponse]]`
(HEL-365) is per-`DataTypeId`, not bulk. HEL-390 shipped `com.helio.ai.ClaudeClient` (`send`/`stream`,
guardrails, `TokenUsage`) with no consumer yet — this is its first caller. `PipelineRunStreamRoutes`
(`GET /pipelines/:id/run-events`) is the one existing chunked-SSE precedent:
`HttpEntity.Chunked.fromData(sseContentType, byteSource)` over a `Source[ByteString, _]`. `ServiceError.
UnprocessableEntity` (422) is the established "well-formed request, semantically unprocessable" case.

## Goals / Non-Goals

**Goals:**
- Turn a user's goal into a validated `DashboardProposal`, grounded in the real workspace, reusing
  the apply path's own validation exactly (no divergent copy).
- Both a buffered and a streaming (SSE) response mode, sharing one parse/validate/repair core.

**Non-Goals:**
- Applying the proposal (existing endpoint), chat UI, multi-turn state (sibling tickets).
- Reimplementing cost/token guardrails — inherited entirely from `ClaudeClient` (HEL-390).
- Native Claude tool-use/structured output — HEL-390 didn't model it; out of scope to add here.

## Decisions

**D1 — `DashboardProposalService.validate(proposal, user): Future[Either[ServiceError, Unit]]`,
extracted from `apply`.** A real, behavior-preserving refactor (mirrors the existing `ProposalPanelSupport`
extraction's own precedent): `apply` calls `validate` first, then proceeds exactly as before on
`Right`. `DashboardAuthoringService` calls the same `validate`, so "reject exactly as apply would
reject" is structurally guaranteed, not just tested-to-match.

**D2 — `DashboardAuthoringService` lives in `com.helio.services`, not `com.helio.ai`.** It orchestrates
existing services (`WorkspaceContextService`, `PanelCapabilityService`, `DashboardProposalService`)
and depends on `ClaudeClient` as a collaborator — the same shape as any other service composing a
lower-level client. `com.helio.ai` stays the low-level Claude transport layer only (HEL-390 D1).

**D3 — Panel-capability menu: fan out `PanelCapabilityService.getCapabilities` over the workspace
context's pipeline-output `DataType`s.** `WorkspaceContextService.assemble` doesn't embed capabilities
(confirmed: no reference to `PanelCapabilityService` in it); `Future.traverse` the context's
pipeline-output-kind `dataTypes` through `getCapabilities`, degrading a per-type failure to "no
capabilities listed" for that type rather than failing the whole assembly — mirrors
`WorkspaceContextService.buildPipeline`'s own per-item degrade-not-fail precedent.

**D4 — Model output is parsed as JSON text, not native tool-use.** The system prompt instructs Claude
to respond with *only* a JSON object matching `DashboardProposal`'s wire shape (schema included
verbatim in the prompt); the response text is parsed via the existing spray-json `DashboardProposalProtocol`
formatters. A parse failure is treated identically to a structural-validation failure — both trigger
the repair round-trip (D5). Risk: brittle to a model prefacing/wrapping the JSON — mitigated by an
explicit "respond with ONLY the JSON object, no prose" instruction and a defensive
first-`{`-to-matching-`}` extraction before parsing.

**D5 — Exactly one repair round-trip, bounded.** "A bounded repair round-trip" (singular, per the
ticket) → `MaxRepairAttempts = 1`: on parse failure or `validate` rejection, re-prompt once with the
model's own prior output plus the validation error text; a second failure returns
`ServiceError.UnprocessableEntity` (422) with the last validation error — never a third attempt. Each
attempt independently goes through `ClaudeClient`'s own guardrails (D of Non-Goals) — no separate
budget needed here.

**D6 — Empty-workspace short-circuit before any Claude call.** Zero pipeline-output-kind `DataType`s
in the assembled context → `ServiceError.UnprocessableEntity("Nothing to build a dashboard from...")`
immediately, matching the ticket's "clear signal, not a hallucination" AC and avoiding a wasted
(costed) Claude call for a request that can never succeed.

**D7 — Streaming variant reuses `ClaudeClient.stream`, forwarding text deltas as progress; repair
(if needed) is a second, buffered `send` call, not a second stream.** `?stream=true` on the same
route (not a separate path) — one logical operation, two response shapes, mirroring how `ClaudeClient`
itself offers `send`/`stream` as siblings rather than separate types. A new `AuthoringStreamEvent`
ADT (`Progress(text)`, `Status(label)` — e.g. `"repairing"` — `Result(proposal, warnings)`,
`Error(message)`) serializes to SSE bytes the same way `RunStatusEvent.toSseBytes` does. The repair
attempt, if triggered, runs as a buffered `send` (not a second `stream`) — simpler, and the client
already saw the first attempt's full text as progress, so nothing is lost by not re-streaming the
retry token-by-token.

**D8 — Error mapping.** `ClaudeError.ApiError`/`TransportFailure` → `ServiceError.BadGateway` (upstream
failure); `ClaudeError.GuardrailExceeded` → `ServiceError.UnprocessableEntity` (a legitimate request
too large to process, not a client mistake); repair-exhausted / empty-workspace →
`ServiceError.UnprocessableEntity` (D5/D6).

## Risks / Trade-offs

[D4's JSON-text parsing is more brittle than native structured output] → mitigated by the explicit
prompt instruction + defensive brace-matched extraction; if this proves unreliable in practice, a
follow-up ticket can add real tool-use once `ClaudeClient` models it — no data-model change needed
here, since the target shape (`DashboardProposal`) is unaffected either way.

[D3's per-type capability fan-out adds N extra requests to every authoring call] → bounded by the
same pipeline-output-type count the workspace context itself already returned (no unbounded fan-out);
degrade-not-fail (D3) keeps one slow/failing type from blocking the whole request.

[D7: the repair attempt's un-streamed nature means a client watching progress sees a "repairing"
status with no further token-level detail until the final result] → acceptable: the ticket asks for
progress visibility, not byte-for-byte parity between the first attempt and a rare repair retry.

## Migration Plan

Additive only — new service, new route, new schema; `DashboardProposalService.apply`'s behavior is
unchanged (D1 is refactor-only, verified against its own existing test suite). No deploy prerequisite
beyond HEL-390's own (`ANTHROPIC_API_KEY` in Secret Manager) — already required by that ticket.

## Planner Notes

Self-approved: service/route/protocol placement, panel-capability fan-out shape, JSON-text parsing
(no tool-use), repair bound of 1, SSE event ADT, and every `ServiceError` mapping — all conventional
extensions of existing patterns (`ProposalPanelSupport`'s own precedent, `PipelineRunStreamRoutes`'s
SSE shape, `WorkspaceContextService`'s degrade-not-fail precedent), no new external dependency, no
breaking change to any existing endpoint or schema.

## Open Questions

None outstanding.
