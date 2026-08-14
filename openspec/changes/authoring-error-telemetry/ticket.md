# HEL-401: Error/guardrail UX + authoring telemetry (goal → proposal → apply outcomes)

## Description

The NL authoring flow (HEL-390 client, HEL-392 endpoint, HEL-395 chat surface, HEL-397 multi-turn — all shipped) has several non-happy paths that need first-class UX: an invalid/unusable model proposal, a Claude model failure or timeout, an empty workspace (no pipeline-output DataTypes to build from), and a cost/token-budget rejection. It also needs observability: to improve prompts and catch regressions, the team needs to see goal → proposal → apply outcomes (accepted / rejected / failed) and token cost per authoring request.

This ticket delivers the guardrail/error UX in the chat surface + review flow, and a telemetry trail for authoring outcomes.

Touches: the chat surface + `ProposalReview` error surface (`InlineError` is already used there), the authoring service/endpoint, and a telemetry/audit sink (structured logs and/or a table — see Flyway note). Backend logs are JSON in prod (`LOG_FORMAT=json`, HEL-115) with trace context (HEL-116).

## Scope

* Frontend TS: explicit UX for each failure mode on the chat surface — model failure/timeout (retry), invalid proposal (show validation warnings, offer refine), empty workspace (guide the user to create a pipeline first, reusing the `ProposalReviewPage` empty-state guidance), and budget-exceeded (clear message). Follow `DESIGN.md`.
* Backend Scala: map the authoring service's failure modes to distinct, structured error responses (not opaque 500s) the UI can branch on.
* Telemetry: record each authoring request's outcome — goal (or a privacy-safe hash/length), proposal panel count, validation warnings, apply outcome (accepted/rejected/failed), model id, and token usage/cost. Emit as structured JSON logs (Cloud Logging severity + MDC, per HEL-115/HEL-116) AND/OR persist to an authoring-telemetry table. **If a table is added, Flyway migration: next available VNN, assigned at scheduling time** — verify the actual current head migration in this worktree at planning time, do not trust any version number written here as of ticket authoring. Never log the API key or raw secret material.
* Tests: ScalaTest that each failure mode yields its distinct error + a telemetry record; Jest/RTL that the chat surface renders the right UX per error; assert no secret is logged.
* Follow-up fold-in (post-evaluation, both approved via the delivery-time triage escalation — small effort, high overlap with this ticket's own diff, no future ticket in the epic to defer to):
  * Move `DashboardAuthoringService.scala`'s telemetry-outcome helpers (`failWithTelemetry`/`succeedWithTelemetry`/`failStreamEvent`/`succeedStreamEvent`) into a new sibling object alongside `AuthoringTelemetry.scala`, bringing the service closer to (not reliably under — the threshold is informational, and the AC below only requires relocation, not a specific line count) CONTRIBUTING.md's ~400-line split threshold.
  * Add a correlation assertion to `AuthoringTelemetrySpec`'s "generated" outcome tests (buffered + streaming) confirming the telemetry line's `authoringRequestId` matches the response's own — the join key that makes design.md D4's funnel-correlation claim actually verifiable end-to-end.

## Acceptance criteria

- [ ] Model failure, invalid proposal, empty workspace, and budget-exceeded each have distinct, actionable UX (not a generic error toast).
- [ ] Backend returns structured, branchable errors for each mode; no opaque 500 for expected failures.
- [ ] Every authoring request emits a telemetry record: outcome (accepted/rejected/failed), panel count, model id, token/cost usage; goal is recorded privacy-safely.
- [ ] Telemetry is structured JSON (HEL-115 format, HEL-116 trace context); if a table is added, its Flyway migration uses the next available VNN (not hardcoded).
- [ ] No secret/API key appears in any log or telemetry record (verified by test).
- [ ] `sbt test` + `npm test` + lint/format green.
- [ ] Backward-compat: additive; happy path unchanged.
- [ ] `DashboardAuthoringService.scala`'s telemetry-outcome helpers live in a new sibling object alongside `AuthoringTelemetry.scala`, not inline in the service — all 4 (`failWithTelemetry`/`succeedWithTelemetry`/`failStreamEvent`/`succeedStreamEvent`), none left behind.
- [ ] `AuthoringTelemetrySpec`'s "generated" outcome tests assert the telemetry line's `authoringRequestId` matches the response's own, for both buffered and streaming paths.

## Out of scope

* The base endpoint, chat surface, and multi-turn state (sibling tickets, all shipped) — this layers UX + observability on top.
* A full analytics dashboard over the telemetry (out of scope; emit the data only).

## Dependencies

* Depends on the HEL-341 NL authoring endpoint + chat-surface tickets (all shipped: HEL-390, HEL-392, HEL-395, HEL-397). May bear a Flyway migration (if a telemetry table is chosen). This is the last ticket in the HEL-341 epic.
