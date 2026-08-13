## 1. Backend: error kind + protocol

- [x] 1.1 Add `AuthoringErrorKind` (sealed: `ModelFailure`/`InvalidProposal`/`EmptyWorkspace`/
      `BudgetExceeded`) and `AuthoringError(kind, serviceError)` to `com.helio.services`.
- [x] 1.2 Add `AuthoringErrorResponse(kind: String, message: String)` protocol type; a bespoke
      route-level completion helper (not `ServiceResponse.run`) rendering it at the existing status
      codes for authoring routes only — no change to `ServiceError`/`ErrorResponse`.
- [x] 1.3 Add `kind` to `AuthoringStreamEvent.Error`; update `toSseBytes` accordingly.
- [x] 1.4 Add `authoringRequestId: UUID` to `DashboardAuthoringResponse` and the streaming terminal
      `Result` event, minted fresh per successful call.

## 2. Backend: DashboardAuthoringService

- [x] 2.1 Update `mapClaudeError`: `ApiError`/`TransportFailure` → `ModelFailure`;
      `GuardrailExceeded` → `BudgetExceeded` (design.md D2). Map the empty-workspace short-circuit →
      `EmptyWorkspace`; a repair-exhausted invalid proposal → `InvalidProposal`; the HEL-397
      per-conversation-ceiling rejection → `BudgetExceeded` (same kind as the guardrail case, D2).
- [x] 2.2 Add an `AuthoringTelemetry` logger + emit helper taking an explicit MDC snapshot parameter
      (design.md D3 — do NOT rely on ambient `ec`/MDC state): on every `author`/`authorStreaming`
      terminal outcome, log `event=authoring_outcome`, `outcome` (`generated`/`failed`), `kind` (on
      failure), `panelCount` (on success), `modelId`, `inputTokens`/`outputTokens` (real `usage`),
      `goalLength`, `goalHash` (SHA-256, first 12 hex chars) — never raw goal text, never the API key.
      Emit the log call via `Future(...)(new MdcPropagatingExecutionContext(ec, mdcSnapshot))` so the
      trace id is correctly attached regardless of which pool thread runs it.
- [x] 2.3 Thread the MDC snapshot through: `DashboardAuthoringRoutes` captures
      `MDC.getCopyOfContextMap` at the point it calls `service.author`/`authorStreaming` (the
      route-evaluation thread has the trace id set by `TraceContextDirective` at this point) and
      passes it as a new parameter into both service methods, used only by task 2.2's telemetry
      emission — no other behavior depends on it.

## 3. Backend: correlation endpoint

- [x] 3.1 Add `POST /api/authoring/requests/:id/outcome` (`{outcome: "accepted"|"rejected"}`) —
      telemetry-only, no persistence, no interaction with `apply-proposal`'s own logic. Emits a
      telemetry record correlated by `authoringRequestId`, threading its own request's MDC snapshot
      the same way as 2.2/2.3.

## 4. Frontend

- [x] 4.1 Extend `useDashboardAuthoringStream`/`authoringService.ts`/`authoring.ts` types for `kind`
      and `authoringRequestId`.
- [x] 4.2 `AuthoringChatDrawer`: per-kind UX — `ModelFailure` uses the existing retry affordance with
      kind-specific copy; `InvalidProposal` shows the validation message + a refine hint;
      `EmptyWorkspace` renders `EmptyState` (`variant="sidebar"`, same copy as
      `ProposalReviewPage`'s existing empty-state); `BudgetExceeded` shows a clear message naming the
      "start a new conversation" escape hatch.
- [x] 4.3 Forward `authoringRequestId` via `location.state` to `ProposalReviewPage` (additive,
      alongside `proposal`); `handleAccept` calls the new outcome endpoint (`accepted`) after
      `applyDashboardProposal` succeeds; `handleReject` calls it (`rejected`), fire-and-forget — both
      only when `authoringRequestId` is present (never for the pre-existing MCP/demo paths).

## 5. Tests

- [x] 5.1 Backend: each of the 4 `AuthoringErrorKind`s is produced by its trigger condition, asserted
      via the response body's `kind` field (buffered and streaming); a telemetry log line is emitted
      for every terminal outcome (mock/capture the logger, assert fields); the API key never appears
      in any captured log output across all outcomes, including `ModelFailure`. **Explicitly assert
      the trace-id MDC field (`logging.googleapis.com/trace`) is present on an emitted telemetry log
      line** when a trace id was set on the originating request — this is the exact gap the design-gate
      review caught (a claim that would otherwise ship unverified); test both the buffered and
      streaming paths, since they reach the telemetry emission point differently.
- [x] 5.2 Backend: the new outcome endpoint emits a correlated record for `accepted`/`rejected`;
      confirm it never touches `apply-proposal`'s own persistence path (no dashboard/panel created).
- [x] 5.3 Frontend: each failure kind renders its distinct UX (RTL, asserting the specific
      copy/component per kind, not a generic error state); `EmptyWorkspace` renders the same copy as
      `ProposalReviewPage`'s existing empty-state; Accept/Reject call the new endpoint only when
      `authoringRequestId` is present, never for the demo/MCP fixture path.
- [x] 5.4 Confirm pre-existing `DashboardAuthoringServiceSpec`/`AuthoringChatDrawer.test.tsx`/
      `ProposalReviewPage` suites still pass — additive fields only, no behavior change to the happy
      path or to `apply-proposal` itself.
- [x] 5.5 `sbt test` + `npm test` + lint/format green; zero real network calls.
