## Why

The in-app `ProposalReviewPage` already handles reviewing/applying a `DashboardProposal`, but the
only way to *produce* one today is the external helio-mcp server. HEL-390 shipped
`com.helio.ai.ClaudeClient`; this ticket wires it to a real endpoint so a goal becomes a validated,
review-ready proposal without leaving the app.

## What Changes

- Add `DashboardAuthoringService` (`com.helio.services`): assembles workspace context (HEL-345/371)
  + a per-pipeline-output-type panel-capability menu (HEL-365) into a system prompt, calls
  `ClaudeClient`, parses the model's JSON text into a `DashboardProposal`, and validates it via the
  SAME checks the apply path uses — `DashboardProposalService` gains a new `validate` method,
  refactored out of `apply` so both callers share it.
- Add `POST /api/authoring/dashboard` (`{ goal, contextOptions? }` → `{ proposal, warnings }`, never
  applies) and its streaming variant (`?stream=true`, SSE via HEL-390's `ClaudeClient.stream`) —
  mirrors `PipelineRunStreamRoutes`'s existing chunked-SSE shape.
- Bounded self-repair (one round-trip) on a structurally invalid first output; still-invalid returns
  `422`. Empty-workspace short-circuits to `422` before any Claude call — never a hallucination.
- Cost/token guardrails are inherited from `ClaudeClient` (HEL-390) — not reimplemented here.
- **Fold-in (post-delivery follow-up A, coordinator-approved):** `mapClaudeError`'s three branches
  get an end-to-end test through `author`/`authorStreaming`. `GuardrailExceeded` closes a gap where
  `spec.md` already had a scenario but it went unexercised; `ApiError`/`TransportFailure` had no
  `spec.md` coverage at all (only a `design.md` Decision) — this fold-in adds that Scenario too.

## Capabilities

### New Capabilities

- `nl-dashboard-proposal-authoring`: NL-goal-to-`DashboardProposal` endpoint — context assembly,
  Claude call, parse, shared validation, bounded repair, sync + streaming variants.

### Modified Capabilities

(none — `DashboardProposalService`'s apply behavior has no standalone capability spec to delta
against; `validate` is a behavior-preserving extraction, not a requirement change.)

## Impact

- New: `DashboardAuthoringService.scala`, `DashboardAuthoringRoutes.scala`,
  `DashboardAuthoringProtocol.scala` (under `backend/src/main/scala/com/helio/`), matching tests.
- Modified: `DashboardProposalService.scala` (new `validate` method), `ApiRoutes.scala` (wiring),
  `schemas/` (new request/response schema).
- No database/migration impact. No frontend impact (chat UI is a sibling ticket).
