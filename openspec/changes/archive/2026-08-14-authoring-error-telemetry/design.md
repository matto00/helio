## Context

`ErrorResponse(message: String)` (`ResourceProtocol.scala`) is the one shared error body project-wide
— `DashboardAuthoringService.mapClaudeError` currently maps every failure to just `ServiceError.
BadGateway`/`UnprocessableEntity`, so 4 distinct failure modes (model/transport failure, repair-
exhausted invalid proposal, empty workspace, guardrail/budget exceeded) collapse into 2 status codes,
distinguishable only by free-text message. `TraceContextDirective`/`MdcPropagatingExecutionContext`
(HEL-116, building on HEL-115's `LogstashEncoder`) already propagate a Cloud-Logging-searchable trace
id into the MDC for both sync and async log lines — directly reusable for telemetry correlation.
`ProposalReviewPage.handleReject` is purely client-side today (`navigate("/")`, no backend call) —
confirmed no existing touchpoint for a "rejected" outcome. `EmptyState` (`shared/ui/EmptyState.tsx`)
is a generic, already-reusable component (`variant="sidebar"` fits the drawer's narrower width).

## Goals / Non-Goals

**Goals:**
- Every authoring failure mode is distinct and UI-branchable, without changing the shared
  `ServiceError`/`ErrorResponse` contract every other route depends on.
- Full goal → proposal → apply-outcome funnel correlation, privacy-safe, via structured logs only.

**Non-Goals:**
- A new DB table (ticket's own "AND/OR" framing; JSON logs already satisfy the stated AC).
- An in-app analytics dashboard over the telemetry (ticket's own explicit Out-of-scope).
- Any change to `POST /api/dashboards/apply-proposal`'s actual write behavior.

## Decisions

**D1 — `AuthoringErrorKind` is threaded alongside `ServiceError`, not folded into it.**
`ServiceError.scala`'s own doc comment states it's "intentionally a small, closed set" shared by
every service in the codebase — adding authoring-specific cases there would be invasive for one
caller's needs. The real, verified reason a bespoke completion path is needed (not the SSE-precedent
framing an earlier draft used, which doesn't actually apply — `DashboardAuthoringRoutes` already
uses the generic `ServiceResponse.run` for both its non-streaming endpoints today): `ServiceResponse.
completeError` is `private` and hardcodes `ErrorResponse(m)` per `ServiceError` variant, so there is
no way to thread an extra `kind` field through the shared `run`/`completeError` path without either
changing `ErrorResponse` globally (rejected — every other route depends on its current shape) or
bypassing it for this capability's own routes. `sealed trait AuthoringErrorKind { ModelFailure,
InvalidProposal, EmptyWorkspace, BudgetExceeded }`, paired with the existing `ServiceError` in a small
`AuthoringError(kind, serviceError)` the service returns; `DashboardAuthoringRoutes` renders `{kind,
message}` via its own completion helper for its buffered endpoints (the SSE branch was already
necessarily bespoke, for the unrelated structural reason that a `Source`-based chunked response can't
be expressed as `Future[Either[ServiceError, A]]` in the first place). HTTP status codes are
unchanged (`422`/`502`/`503`) — only the body gains a field. `AuthoringStreamEvent.Error` gains the
same `kind`.

**D2 — Guardrail-exceeded and the HEL-397 per-conversation ceiling both map to `BudgetExceeded`.**
Both are the same user-facing story ("you've used your token budget") even though they're different
`ServiceError`s underneath (`UnprocessableEntity` either way, different messages) — one kind, not two,
avoids the UI needing to distinguish a distinction the user doesn't care about.

**D3 — Telemetry is structured JSON log lines, no new table; trace-id propagation is threaded
explicitly, not assumed.** A dedicated `AuthoringTelemetry` logger (`log.info` with MDC-set fields,
consistent with HEL-115's `LogstashEncoder` picking up MDC as top-level JSON fields) emits `event=
authoring_outcome`, `outcome` (`generated`/`failed` — see the note on the AC's enum below), `kind`
(on failure), `panelCount` (on success), `modelId`, `inputTokens`/`outputTokens` (real `usage`, never
the estimate), `goalLength`, `goalHash` (first 12 hex chars of SHA-256 — de-duplication/correlation
without ever storing raw text). **Trace-id propagation requires explicit threading, not the ambient
assumption an earlier draft made**: `DashboardAuthoringService`'s `Future` chains run on a
class-level `ec = system.executionContext` captured once at `ApiRoutes` construction — never
`ctx.executionContext`, the per-request EC `TraceContextDirective` actually swaps for an
`MdcPropagatingExecutionContext`. A telemetry call built naively inside the service (or, worse, on
the streaming path, which has no `ctx.executionContext`/`onComplete` touchpoint at all) would run
trace-id-less. Fix: `DashboardAuthoringRoutes` captures `MDC.getCopyOfContextMap` at the point it
invokes `service.author`/`authorStreaming` (correct there — the route-evaluation thread already has
the trace id set by `TraceContextDirective`, synchronously, before this point) and passes that
snapshot into the service call as data; the telemetry-emission step specifically wraps its log call
via `new MdcPropagatingExecutionContext(ec, snapshot)` — reusing HEL-116's own already-vetted
snapshot/restore primitive at the one call site that actually needs it, rather than relying on
whichever EC happens to be ambient. This applies uniformly to both the buffered and streaming paths,
since it threads the trace id as an explicit value rather than depending on which EC a given code
path happens to run on. A dedicated test/probe verifies the trace-id MDC field is actually present on
an emitted telemetry log line (task 5.1) — this claim doesn't ship as an unverified assumption.

**D4 — Funnel correlation via a minted `authoringRequestId` + a new, telemetry-only endpoint, not a
change to apply-proposal itself; the AC's `{accepted, rejected, failed}` enum is deliberately split
across two append-only log events, not one mutable record (self-approved, see below).** A successful
authoring response includes a fresh `authoringRequestId` (UUID); the frontend forwards it via
`location.state` to `ProposalReviewPage` (additive, alongside the existing `proposal`) and calls a
new `POST /api/authoring/requests/:id/outcome` (`{outcome: "accepted"|"rejected"}`) from
`handleAccept` (after `applyDashboardProposal` succeeds) and `handleReject` (fire-and-forget, closing
the one confirmed gap — reject has no backend touchpoint today). This endpoint does nothing but emit
the correlated telemetry log line — it never touches `apply-proposal`'s own contract, and it's a
no-op for the pre-existing MCP/demo entry paths, which never carry an `authoringRequestId`. **Why the
literal AC enum (`ticket.md`'s "outcome: accepted/rejected/failed") is realized as two separate
`generated`/`failed` (authoring time) and `accepted`/`rejected` (later, correlated) events rather than
one record whose `outcome` field is later mutated**: JSON log lines are append-only — there is no
"one record updated in place" with this storage choice (D3's own Non-Goal), and a request that
succeeds but is never accepted or rejected (the user simply abandons the review) has no AC-literal
outcome to report at all, yet still needs *some* durable signal that a proposal was successfully
generated (for prompt-quality analysis, independent of whether it was ever applied) — hence
`generated`, a value the literal AC enum doesn't name but that the two-event design requires to avoid
silently dropping every abandoned-but-successful authoring call from telemetry entirely.

**Known limitation (non-blocking):** `location.state` doesn't survive a fresh (non-Back/Forward)
navigation to `/proposals/review` — `ProposalReviewPage` falls back to `synthesizeDemoProposal` with
no `authoringRequestId` in that case, so an `accepted`/`rejected` correlation is silently skipped.
This pre-exists this ticket (the same fallback already governs the MCP/demo entry path) and telemetry
completeness is already explicitly best-effort (fire-and-forget); stated here rather than left
implicit.

**D5 — Frontend UX per kind, reusing existing primitives over inventing new ones.** `ModelFailure`:
the drawer's existing retry affordance (already present) with kind-specific copy. `InvalidProposal`:
the validation message plus a "try refining your goal" hint (still `InlineError`, kind-aware copy).
`EmptyWorkspace`: `EmptyState` (`variant="sidebar"`), the SAME copy `ProposalReviewPage`'s own
empty-state already uses (per the ticket's explicit "reusing the ProposalReviewPage empty-state
guidance" ask) — not a re-authored message. `BudgetExceeded`: a clear message naming the escape hatch
(start a new conversation), mirroring HEL-397 design.md's own guardrail-message rationale.

## Risks / Trade-offs

[D1 adds a bespoke error-rendering path for one route rather than extending the shared one] →
scoped deliberately: the shared `ServiceError`/`ErrorResponse` contract stays exactly as every other
route already relies on it; only this capability's own routes render the richer body.

[D4's "rejected" telemetry is fire-and-forget from the client — a network failure silently drops it]
→ acceptable: telemetry data loss doesn't corrupt or block any real user-facing action (proposal
review/apply already completed by the time this fires); the AC asks for observability, not an
exactly-once delivery guarantee.

[D3's goal-hash could theoretically be reversed for a very short/common goal via a rainbow table] →
acceptable: this is a de-duplication/correlation aid over already-non-sensitive product-usage text
(dashboard goals, not credentials or PII), not a security boundary; length alone would already narrow
the space similarly for a short goal regardless of hashing.

## Migration Plan

Additive only: new response/error fields, one new telemetry-only route, no schema/table changes, no
change to any existing route's behavior when the new fields are simply absent/ignored.

## Planner Notes

Self-approved: `AuthoringErrorKind`'s shape and the decision to keep it separate from `ServiceError`
(D1), the guardrail/ceiling kind-merge (D2), log-only telemetry with no new table and the explicit
`MdcPropagatingExecutionContext` trace-threading fix (D3, matches the ticket's own "AND/OR" wording;
the trace-propagation approach is verification-gated by a dedicated test, not assumed), the
correlation-endpoint design and its `generated`/`failed`/`accepted`/`rejected` two-event realization
of the AC's literal `{accepted,rejected,failed}` enum (D4, the one genuinely new piece of surface,
narrowly scoped to telemetry only — flagged explicitly here per the design-gate review that caught it
was previously undocumented as a judgment call), and per-kind frontend UX reusing existing primitives
(D5) — all additive, no new external dependency, no breaking change to any existing contract.

## Open Questions

None outstanding.
