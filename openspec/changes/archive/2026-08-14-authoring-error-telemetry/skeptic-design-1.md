## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

1. **`ServiceError`/`ErrorResponse`/`ServiceResponse` shapes** — read the real source, not the
   design's paraphrase:
   - `backend/src/main/scala/com/helio/services/ServiceError.scala:10-13` — the doc comment really
     does say "This is intentionally a small, closed set..." — design.md's D1 quote is accurate.
   - `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala:69-79` — `completeError` is
     `private` and hardcodes `ErrorResponse(m)` per `ServiceError` variant; there is no way to thread
     an extra `kind` field through the shared `run`/`completeError` path without either changing
     `ErrorResponse` (out of scope per D1) or bypassing it. D1's core technical decision (bespoke
     completion helper for authoring routes) is therefore justified on the merits.
   - **However**, D1's *stated rationale* is inaccurate: `DashboardAuthoringRoutes.scala:52`
     (`ServiceResponse.run(service.author(request, user))(identity)`) and `:63`
     (`ServiceResponse.run(service.getConversation(id, user))(identity)`) show the route **already
     uses the generic `ServiceResponse.run` helper** for both its non-streaming endpoints today. Only
     the SSE branch (`:49-50`) is structurally bespoke, because a `Source`-based chunked response
     can't be expressed as `Future[Either[ServiceError, A]]` in the first place — that's a necessity,
     not a stylistic precedent for bypassing `ServiceResponse.run` on the *buffered* path. D1's
     "matching this route's existing non-generic SSE handling" framing overstates precedent that
     doesn't actually exist for the buffered case it's citing to justify. See Change Request 2.

2. **DB-table skip vs. the ticket's literal AC text** — re-read `ticket.md` ACs directly (not just the
   scope's "AND/OR" line):
   - AC (ticket.md:22): *"Every authoring request emits a telemetry record: outcome
     (accepted/rejected/failed), panel count, model id, token/cost usage; goal is recorded
     privacy-safely."* — this literally enumerates the `outcome` value set as exactly
     `{accepted, rejected, failed}` and speaks of "**a** telemetry record" (singular) per request.
   - design.md's D3 instead emits, at authoring-completion time, `outcome ∈ {generated, failed}` — a
     value ("`generated`") that appears **nowhere** in the ticket's AC — with `accepted`/`rejected`
     deferred to a wholly separate, later, correlated log line only fired if/when the user acts in
     Proposal Review (D4). A request that succeeds and is never accepted/rejected (user abandons)
     will **never** emit any of the three AC-literal outcome values. This is a defensible engineering
     translation of an inherently mutable "final funnel state" into two immutable JSON log events (you
     can't literally have "one record whose outcome later becomes accepted" with append-only logs —
     that argues *for* skipping a table is at least debatable, not merely `AND/OR`-clear), but it is a
     genuine reinterpretation of the AC's literal enum that design.md never flags as a self-approved
     judgment call (unlike D1/D2/D4, which are explicitly listed in Planner Notes). See Change
     Request 3.
   - AC (ticket.md:23) *"if a table is added, its Flyway migration uses the next available VNN"* is
     conditional wording that does support "table is optional" — that half of the design's reasoning
     holds up.

3. **`ProposalReviewPage.handleReject` claim** — read
   `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx:73`:
   `const handleReject = () => navigate("/");` — confirmed purely client-side, no backend call, no
   existing outcome touchpoint. design.md's claim here is accurate.
   - Reload/navigate-away-and-back gap: `location.state` is React Router's in-memory-but-history-
     backed state; a same-tab reload typically survives it (browser `history.state` persists across
     reload), but a **fresh navigation** to `/proposals/review` (not via Back/Forward) loses it
     entirely — `stateProposal` becomes `undefined` and the page falls back to
     `synthesizeDemoProposal` (:53-57, :118-152), silently showing an unrelated demo proposal with no
     `authoringRequestId`. This pre-exists this ticket (not newly introduced) and telemetry
     completeness is already explicitly non-guaranteed by D4's own Risk section, so I'm treating this
     as a non-blocking note, not a Change Request — but it should be called out explicitly in
     design.md rather than left implicit.

4. **D2 (GuardrailExceeded + HEL-397 ceiling → one `BudgetExceeded` kind)** — read
   `DashboardAuthoringService.scala:242-246` (`mapClaudeError`) and `:178-187`
   (`loadForContinuation`): both `ClaudeError.GuardrailExceeded` (pre-flight input-token estimate over
   `ClaudeConfig.maxInputTokens`) and the HEL-397 per-conversation ceiling
   (`record.totalTokensUsed >= AuthoringHistoryBudget.DefaultMaxConversationTokens`) **already** map
   to the identical `ServiceError.UnprocessableEntity`, distinguished today only by message text. The
   ticket's own Description (ticket.md:5) lists exactly one budget-type failure mode ("a cost/token-
   budget rejection") — merging both into one `AuthoringErrorKind.BudgetExceeded` doesn't lose
   information the AC asks the UI to distinguish. Reasonable simplification, not a gap.

5. **Trace-context claim ("just works", "no new plumbing needed") — REFUTED by the real wiring.**
   This is the headline finding. Traced:
   - `backend/src/main/scala/com/helio/api/ApiRoutes.scala:110`:
     `private implicit val ec = system.executionContext` — a single class-level EC, captured **once**
     at `ApiRoutes` construction (app startup), used to build `DashboardAuthoringService` at `:268`.
   - `TraceContextDirective.scala:65-75` (`applyTrace`) swaps `ctx.executionContext` — the **per-
     request routing context's** EC — for an `MdcPropagatingExecutionContext` snapshotting the MDC at
     route-evaluation time. This swap only affects code that actually resolves its EC from `ctx`
     (Pekko HTTP directives like `onComplete`/`onSuccess` that read `ctx.executionContext`
     implicitly) — confirmed by grepping the codebase: `MdcPropagatingExecutionContext` is
     constructed/used **only** inside `TraceContextDirective.scala` (`grep -rl
     MdcPropagatingExecutionContext backend/src/main/scala` returns exactly those two files).
   - `DashboardAuthoringService`'s entire internal `Future`/`.flatMap` chain (`assembleGroundedContext`
     → `claudeClient.send(...).flatMap(...)` → `parseAndValidate(...)` → the very telemetry call task
     2.2 proposes adding) is built using the **service's own captured `ec` = `system.executionContext`**
     — never `ctx.executionContext`, never the swapped MDC-propagating EC. `claudeClient.send` is a
     real network call; every continuation after it runs on a plain dispatcher-pool thread with no MDC
     set. Only the *outermost* route completion (`ServiceResponse.run`'s `onSuccess(result){...}`,
     which schedules its callback via `ctx.executionContext`) gets the trace id — by which point the
     proposed telemetry log call (inside the service) has already executed, off-thread, without it.
   - This is **not a hypothetical** — it is exactly the "capture-timing pitfall" the sibling HEL-116
     ticket's own design.md (`openspec/changes/archive/2026-07-21-trace-context-into-logs/design.md`,
     D3) explicitly documented and required a *probe* to resolve, scoped narrowly to "the async
     `onComplete` error logs" directly inside `ApiRoutes` (i.e., callbacks that resolve their EC from
     `ctx`) — not to arbitrary service-internal `Future` chains built with a different captured EC.
     HEL-401's design.md asserts the opposite conclusion ("no new plumbing needed") for a strictly
     harder case (deep service-internal async chains, plus a streaming/`Source`-based variant that has
     no `onComplete`/`ctx.executionContext` touchpoint at all) without running the same probe HEL-116's
     own precedent says this class of claim requires. See Change Request 1 (primary).
   - Compounding: the AC (`ticket.md:23`) and the change's own spec
     (`specs/authoring-error-telemetry/spec.md:20-21`, "carrying HEL-116 trace context automatically")
     make trace-context a **required** characteristic of the telemetry, yet `tasks.md` 5.1 ("a
     telemetry log line is emitted for every terminal outcome... assert fields") never proposes
     asserting the trace-id MDC key is actually present — so this gap, if it ships as designed, would
     not be caught by the tests the plan itself specifies.

### Verdict: REFUTE

### Change Requests

1. **(Primary) Fix D3's trace-context claim before implementation starts.** `DashboardAuthoringService`
   builds its `Future` chains with a class-level `ec = system.executionContext` captured once at
   `ApiRoutes` construction — never the per-request `MdcPropagatingExecutionContext` that
   `TraceContextDirective` installs on `ctx.executionContext`. As designed, telemetry log lines emitted
   from inside the service (task 2.2, both `author`/buffered and `authorStreaming`/SSE) will not carry
   the HEL-116 trace id. Revise design.md D3 to either: (a) explicitly thread the request's MDC
   snapshot (captured at the route boundary, where `ctx`'s trace-bearing EC is actually available) into
   the service call / telemetry emission, or (b) move telemetry emission to the route layer for the
   buffered path (where `onSuccess`'s callback does run on the trace-bearing EC) and design a
   comparable mechanism for the streaming path (where there's no `onComplete`/`ctx.executionContext`
   touchpoint at all — `Source` materialization runs on the `Materializer`'s dispatcher, not `ctx`'s
   swapped EC), or (c) follow HEL-116's own precedent (design.md D3 in
   `openspec/changes/archive/2026-07-21-trace-context-into-logs/`) and make this an explicit
   probe-first task per `.concertino/laws/systematic-debugging.md` rather than an assumed fact. Add a
   verification task (probe or test) that actually asserts the trace-id MDC field is present on an
   emitted telemetry log line, since AC (`ticket.md:23`) and `specs/authoring-error-
   telemetry/spec.md:20-21` both require it and no current task would catch its absence.

2. **Correct D1's stated rationale.** `DashboardAuthoringRoutes.scala:52` and `:63` show the route
   *already* uses the generic `ServiceResponse.run` for both its non-streaming endpoints today — only
   the SSE branch is inherently bespoke (structurally, not stylistically). D1's "matching this route's
   existing non-generic SSE handling" framing cites precedent that doesn't apply to the buffered case
   it's justifying. The underlying decision (bypass `ServiceResponse.run` for the buffered authoring
   response to carry `kind`) is independently justified — `ServiceResponse.completeError` is `private`
   and hardcodes `ErrorResponse` — so this is a documentation-accuracy fix to design.md's D1, not a
   change to the technical approach.

3. **Reconcile the telemetry `outcome` value set with the ticket's literal AC enum, explicitly.**
   ticket.md's AC (line 22) enumerates `outcome` as exactly `{accepted, rejected, failed}` for "a
   telemetry record" per authoring request. design.md's D3 instead emits `{generated, failed}` at
   authoring-completion time (introducing `generated`, which is not in the AC's enum) and defers
   `{accepted, rejected}` to a second, separate, correlated log line that may never fire (D4's own
   accepted fire-and-forget risk). Add this as an explicit, flagged self-approved decision in Planner
   Notes (as D1/D2/D4 already are) with the specific justification for why two append-only log events
   with a `generated` value not in the AC text still satisfies AC3's "a telemetry record: outcome
   (accepted/rejected/failed)" — or adjust the design so the outcome vocabulary actually emitted lines
   up with what the AC states.

### Non-blocking notes

- `ProposalReviewPage`'s `location.state` loss on a fresh (non-Back/Forward) navigation to
  `/proposals/review` silently falls back to the demo proposal and drops `authoringRequestId` — this
  pre-exists the ticket and telemetry completeness is already explicitly best-effort, but design.md
  should say so explicitly rather than leaving it as an unstated edge case.
- D2's merge of `GuardrailExceeded` and the HEL-397 per-conversation ceiling into one `BudgetExceeded`
  kind is sound — both already collapse to the same `ServiceError.UnprocessableEntity` today, and the
  ticket's own description only anticipates one budget-type failure mode.
