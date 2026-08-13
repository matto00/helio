## Why

The in-app `ProposalReviewPage` already handles reviewing/applying a `DashboardProposal`, but the
only way to *produce* one today is the external helio-mcp server. HEL-390 shipped the underlying
`com.helio.ai.ClaudeClient`; this ticket wires it to a real endpoint so a user's goal becomes a
validated, review-ready proposal without leaving the app.

## What Changes

- Add `DashboardAuthoringService` (`com.helio.services`): assembles workspace context (HEL-345/371)
  + a per-pipeline-output-type panel-capability menu (HEL-365) into a system prompt, calls
  `ClaudeClient`, parses the model's JSON text into a `DashboardProposal`, and validates it via the
  SAME checks the apply path uses — `DashboardProposalService` gains a new `validate` method
  (structural + binding checks, no side effects), refactored out of `apply` so both callers share it.
- Add `POST /api/authoring/dashboard` (`{ goal, contextOptions? }` → `{ proposal, warnings }`, never
  applies) and its streaming variant (`?stream=true`, SSE, reusing HEL-390's `ClaudeClient.stream`
  for progress) — mirrors `PipelineRunStreamRoutes`'s existing chunked-SSE shape.
- Bounded self-repair (one round-trip) on a structurally invalid first output; still-invalid returns
  `422`. Empty-workspace short-circuits to `422` before any Claude call — never a hallucination.
- Cost/token guardrails are inherited from `ClaudeClient` (HEL-390) — not reimplemented here.

## Capabilities

### New Capabilities

- `nl-dashboard-proposal-authoring`: NL-goal-to-`DashboardProposal` authoring endpoint — context
  assembly, Claude call, parse, shared-validation reuse, bounded repair, sync + streaming variants.

### Modified Capabilities

(none — `DashboardProposalService`'s apply behavior has no existing standalone capability spec to
delta against; the new `validate` method is a behavior-preserving extraction, not a requirement
change. `combined-proposal-apply` composes both proposal services unchanged either way.)

## Impact

- New: `backend/src/main/scala/com/helio/services/DashboardAuthoringService.scala`,
  `backend/src/main/scala/com/helio/api/routes/DashboardAuthoringRoutes.scala`,
  `backend/src/main/scala/com/helio/api/protocols/DashboardAuthoringProtocol.scala`, matching tests.
- Modified: `DashboardProposalService.scala` (new `validate` method, `apply` calls it),
  `ApiRoutes.scala` (wire new routes), `schemas/` (new request/response schema for the endpoint).
- No database/migration impact. No frontend impact (chat UI is a sibling ticket).
