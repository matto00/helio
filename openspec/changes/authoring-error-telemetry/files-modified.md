# Files modified — HEL-401 authoring-error-telemetry

Note: `git diff --name-only main...HEAD` includes files from prior, already-committed tickets on
this branch (HEL-397/HEL-395 archives etc.) that predate this session. The list below is this
session's actual change set, from `git status --porcelain` (uncommitted at handoff time).

## Backend — new files

- `backend/src/main/scala/com/helio/services/AuthoringError.scala` — `AuthoringErrorKind` (sealed,
  4 cases) + `AuthoringError(kind: Option[AuthoringErrorKind], serviceError, tokensUsed)` (design.md
  D1). `kind` is `Option` (not bare) so a failure outside the 4 defined categories, e.g. a missing
  conversation `NotFound`, can still flow through the same type without inventing a 5th kind.
- `backend/src/main/scala/com/helio/services/AuthoringTelemetry.scala` — structured JSON telemetry
  emitter (design.md D3/D4): `emitGenerated`/`emitFailed` (`event=authoring_outcome`) and
  `emitApplyOutcome` (`event=authoring_apply_outcome`, the correlation endpoint). Every emit call is
  fire-and-forget via `Future(...)(new MdcPropagatingExecutionContext(ec, mdcSnapshot))` — the one
  call site in this capability that needs an MDC-aware EC.
- `backend/src/test/scala/com/helio/api/routes/AuthoringTelemetrySpec.scala` — tasks.md 5.1/5.2: all
  4 `AuthoringErrorKind`s asserted on the real HTTP/SSE response body (buffered + streaming), a real
  captured `LogstashEncoder` JSON log line asserted per outcome (including the trace-id MDC field —
  the exact claim the design-gate round-1 review caught as unverified), the API key never appearing
  in captured output, and the outcome-correlation endpoint (accepts an id it never looks up, proving
  it never touches `apply-proposal`'s persistence).
- `backend/src/test/scala/com/helio/testutil/JsonLogCapture.scala` — shared `LogstashEncoder`
  capture helper (`withCapture`), attaching to the REAL global Logback logger (not an isolated
  context, since `AuthoringTelemetry`'s logger is resolved once via a fixed name) and exposing a
  `() => String` poll accessor for the fire-and-forget telemetry Future's async landing.

## Backend — modified

- `backend/src/main/scala/com/helio/ai/ClaudeClient.scala` — added `def modelId: String =
  config.model` accessor (telemetry needs the model id, never the whole config/key).
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports `AuthoringErrorResponse`/
  `AuthoringOutcomeRequest` into `com.helio.api` (matches this file's existing re-export
  convention for every other authoring protocol type).
- `backend/src/main/scala/com/helio/api/protocols/DashboardAuthoringProtocol.scala` —
  `DashboardAuthoringResponse` gains `authoringRequestId: String`; new `AuthoringErrorResponse(kind,
  message)` and `AuthoringOutcomeRequest(outcome)` types + formats; `AuthoringStreamEvent.Result`
  gains `authoringRequestId`, `AuthoringStreamEvent.Error` gains `kind: Option[String] = None`
  (default-valued — every pre-existing single-arg `Error(message)` call site keeps compiling);
  `toSseBytes` updated for both, `kind` omitted from the JSON entirely (not `null`) when absent.
- `backend/src/main/scala/com/helio/api/routes/DashboardAuthoringRoutes.scala` — captures
  `MDC.getCopyOfContextMap()` at the route-evaluation instant (before `TraceContextDirective`'s trace
  id would otherwise be lost) and threads it into `service.author`/`authorStreaming`; a bespoke
  `completeAuthoring` helper renders `{kind, message}` only for `AuthoringError`s that carry a kind,
  falling back to the pre-existing bare `ErrorResponse` shape otherwise; new
  `POST /api/authoring/requests/:id/outcome` route, mounted unconditionally (telemetry-only, no
  `serviceOpt` dependency).
- `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala` — extracted the existing
  per-`ServiceError`-variant status-code switch into `private[routes] def statusCodeFor` (was inlined
  in `completeError`) so `DashboardAuthoringRoutes`'s bespoke completion helper can reuse the SAME
  mapping instead of duplicating it — the only thing that route bypasses is the response BODY shape.
- `backend/src/main/scala/com/helio/services/DashboardAuthoringService.scala` — major rewrite:
  `implicit ec` widened `ExecutionContext` → `ExecutionContextExecutor` (needed to construct
  `MdcPropagatingExecutionContext`); `mapClaudeError`/the empty-workspace short-circuit/the
  repair-exhausted branch/the per-conversation-ceiling branch now return `AuthoringError` instead of
  bare `ServiceError`; `AttemptOutcome` carries `TokenUsage` (real input/output, not just a combined
  total) for telemetry; `author`/`authorStreaming` gain an additive `mdcSnapshot` parameter
  (default `null`) and mint a fresh `authoringRequestId` per successful call; telemetry emission is
  centralized in small `failWithTelemetry`/`succeedWithTelemetry`/`failStreamEvent`/
  `succeedStreamEvent` helpers reused by both the buffered and streaming paths.
- `backend/src/test/scala/com/helio/api/routes/DashboardAuthoringRoutesSpec.scala` — `routeEc`
  widened `ExecutionContext` → `ExecutionContextExecutor` (compile-only; same reason as above).
- `backend/src/test/scala/com/helio/services/DashboardAuthoringServiceSpec.scala` — `routeEc`
  widened the same way; ~9 assertions that pattern-matched `result.swap.toOption.get` directly
  against a `ServiceError` subtype now unwrap `.serviceError` first (mechanical, since `author`'s
  Left channel is now `AuthoringError`) — every assertion still checks the exact same
  status-determining `ServiceError` variant/message/invocation-count it did before.

## Schemas

- `schemas/dashboard-authoring-response.schema.json` — added `authoringRequestId` (required).
- `schemas/authoring-outcome-request.schema.json` — new schema for
  `POST /api/authoring/requests/:id/outcome`'s request body.

## Frontend

- `frontend/src/features/dashboards/types/authoring.ts` — new `AuthoringErrorKind`/`AuthoringOutcome`
  types; `AuthoringResult` gains `authoringRequestId: string`.
- `frontend/src/features/dashboards/services/authoringService.ts` — new `postAuthoringOutcome`.
- `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.ts` — new `errorKind` state
  field, parsed from the `authoring-error` SSE event's optional `kind`.
- `frontend/src/features/dashboards/utils/emptyWorkspaceCopy.ts` — new shared
  `EMPTY_WORKSPACE_COPY` constant, used by BOTH `ProposalReviewPage` and `AuthoringChatDrawer` so the
  `EmptyWorkspace` copy can never drift out of sync between the two surfaces (design.md D5's explicit
  "reuse the SAME copy" ask).
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.tsx` / `.css` — per-kind error UX:
  `ModelFailure`/`BudgetExceeded` show kind-specific copy (not the raw, possibly technical server
  message); `InvalidProposal` shows the raw validation message + a refine hint; `EmptyWorkspace`
  renders the shared `EmptyState` (`variant="sidebar"`) instead of the InlineError+retry block;
  `BudgetExceeded` gets its own "Start a new conversation" action (clears conversation state, unlike
  the plain "Try again" retry); forwards `authoringRequestId` to Proposal Review on "Review & apply".
- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` — reads `authoringRequestId` from
  `location.state`; `handleAccept` calls `postAuthoringOutcome(id, "accepted")` after apply succeeds;
  `handleReject` calls `postAuthoringOutcome(id, "rejected")` — both fire-and-forget, both no-ops
  when `authoringRequestId` is absent (pre-existing MCP/demo paths); empty-state copy now sourced
  from the shared `EMPTY_WORKSPACE_COPY` constant instead of an inline literal.
- `frontend/src/features/dashboards/ui/ProposalReviewPage.test.tsx` (new) — Accept/Reject correlation
  behavior, including the "never fires without authoringRequestId" and "never fires on a failed
  apply" cases.
- `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.test.ts`,
  `frontend/src/features/dashboards/ui/AuthoringChatDrawer.test.tsx`,
  `frontend/src/features/dashboards/services/authoringService.test.ts` — extended with the new
  kind/authoringRequestId/postAuthoringOutcome coverage described above.

## Root cause / probe notes (systematic-debugging law)

- **AuthoringTelemetrySpec's implicit-EC ambiguity**: declaring a local `implicit val ec:
  ExecutionContextExecutor` in a `ScalatestRouteTest` subclass collided with the trait's own
  inherited `executor: ExecutionContextExecutor` (identical type, so neither wins on specificity) —
  `sbt Test/compile` failed with "ambiguous implicit values" at every repository-construction call
  site. Fix: declared it as the less-specific `ExecutionContext` (matching the working
  `DashboardAuthoringRoutesSpec` precedent), which lets the trait's more-specific `executor` win
  unambiguously; behavior is identical either way since both resolve to the same runtime dispatcher.
- **ProposalReviewPage.test.tsx's "no accessible roles" failure**: `getByRole("button", ...)` failed
  on every test with "There are no accessible roles" even though `findByDisplayValue` had already
  confirmed the dialog's content was in the DOM. Root cause: `beforeEach(() => jest.resetAllMocks())`
  resets EVERY `jest.fn()` in the test file's module scope, including the `beforeAll`-installed
  `HTMLDialogElement.prototype.showModal`/`.close` stubs — stripping their `this.open = true`
  implementation before every test, so the `<dialog>` never actually opened and testing-library's
  role computation (which respects a closed dialog's implicit hidden state) found nothing. Probe:
  switching to `jest.clearAllMocks()` (clears call history only, keeps the stub's implementation)
  made all 5 tests pass immediately, confirming the diagnosis.
