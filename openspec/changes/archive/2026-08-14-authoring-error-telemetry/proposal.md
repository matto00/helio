## Why

The NL authoring flow (HEL-390/392/395/397, all shipped) collapses every failure into one of two
bare `{message: String}` bodies (`422`/`502`) — the UI can't reliably branch on *why* a call failed,
and there is no observability into goal → proposal → apply outcomes to improve prompts or catch
regressions. This is the epic's last ticket: distinct, actionable failure UX, and a telemetry trail.

## What Changes

- New `AuthoringErrorKind` (`ModelFailure`/`InvalidProposal`/`EmptyWorkspace`/`BudgetExceeded`)
  threaded alongside the existing `ServiceError` (which still determines HTTP status, unchanged) —
  authoring routes render `{kind, message}` instead of the generic `ErrorResponse`; the streaming
  terminal `Error` event gains the same `kind` field. No change to `ServiceError`/`ErrorResponse`
  themselves or to any other route's error contract.
- Structured JSON telemetry (HEL-115 format, HEL-116 trace context), no new DB table: one log line
  per authoring outcome (`generated`/`failed`, kind, panel count, model id, token usage, a
  privacy-safe goal length + truncated hash — never raw goal text), plus a new lightweight
  `POST /api/authoring/requests/:id/outcome` endpoint (`accepted`/`rejected`) the frontend calls from
  the existing Proposal Review Accept/Reject actions — correlating the full funnel without touching
  the actual apply-proposal write path at all.
- Frontend: distinct UX per failure kind on the chat surface (retry for `ModelFailure`, a refine
  prompt for `InvalidProposal`, the existing `EmptyState` component — reused, not reinvented — for
  `EmptyWorkspace`, a clear budget message for `BudgetExceeded`).
- Follow-up fold-in (approved at delivery time, folded into this same change rather than a
  separate ticket — small effort, high overlap with this diff, no future ticket in the epic to
  defer to): relocate `DashboardAuthoringService.scala`'s telemetry-outcome helper functions into
  a new sibling object alongside `AuthoringTelemetry.scala` (behavior-preserving; `succeedWithTelemetry`/
  `succeedStreamEvent` take `AttemptOutcome`'s constituent fields as separate parameters rather
  than the case class itself, which is private to `DashboardAuthoringService` — no visibility
  widening. Brings the service closer to CONTRIBUTING.md's informational file-size threshold, not
  reliably under it), and add the one missing `authoringRequestId` correlation assertion to
  `AuthoringTelemetrySpec`'s "generated" outcome tests so D4's funnel-correlation claim is
  actually test-verified end-to-end.

## Capabilities

### New Capabilities

- `authoring-error-telemetry`: distinct branchable authoring error kinds, structured JSON outcome
  telemetry, and the accept/reject correlation endpoint.

### Modified Capabilities

- `nl-dashboard-proposal-authoring` (HEL-392): error responses gain a `kind` field (additive); a
  successful response gains an `authoringRequestId` (additive) for later outcome correlation.

## Impact

- New: `AuthoringErrorKind`/telemetry logging helper, `POST /api/authoring/requests/:id/outcome`
  route, frontend per-kind error UI states.
- Modified: `DashboardAuthoringService`/`Routes`/`Protocol` (additive fields), `AuthoringChatDrawer`
  (per-kind UX), `ProposalReviewPage` (fires the new outcome call on Accept/Reject when an
  `authoringRequestId` is present — a no-op for the pre-existing MCP/demo entry paths, which never
  carry one).
- No Flyway migration (telemetry is log-only, per the ticket's own "AND/OR" framing). No changes to
  `POST /api/dashboards/apply-proposal` itself — the actual write path is untouched.
