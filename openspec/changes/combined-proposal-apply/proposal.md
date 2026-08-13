## Why

"Build me a dashboard from this CSV" needs one atomic act: a source, a pipeline producing a bindable
output type, and a dashboard whose panels bind to that brand-new type. Today `DashboardProposal` can
only reference a **pre-existing** DataType id, and the pipeline apply path (HEL-383) produces a type
but builds no panels — neither alone closes the loop, and there's no way to reference an id that
doesn't exist yet at proposal-authoring time.

## What Changes

- New `CombinedProposal { pipeline: PipelineProposal, dashboard: DashboardProposal }` protocol/schema.
  A dashboard panel binds to the pipeline's not-yet-created output type via a reserved sentinel string
  (`"$pipelineOutput"`) in the exact same `dataTypeId`/`config.dataTypeId` slot `DashboardProposal`
  already uses — **no change to `ProposalPanel`'s shape at all**.
- New `CombinedProposalService`: pre-validates the sentinel only appears where it's resolvable (nothing
  created on a bad proposal), applies the pipeline proposal via the unmodified `PipelineProposalService`,
  substitutes the real output DataType id for the sentinel, then applies the dashboard proposal via the
  unmodified `DashboardProposalService`. On a dashboard-phase failure, rolls back the pipeline+source via
  one new public method added to `PipelineProposalService`.
- New `POST /api/proposals/apply` route.
- New MCP tool exposing the combined flow (no MCP schema changes needed beyond the new tool itself — the
  sentinel travels through the existing `panelSchema` unchanged).

## Capabilities

### New Capabilities

- `combined-proposal-apply`: atomic source+pipeline+run+dashboard+panels creation from one proposal,
  with sentinel-based output-type binding and full rollback on a dashboard-phase failure.

### Modified Capabilities

(none — this reuses `DashboardProposalService`/`PipelineProposalService` unchanged aside from one new
additive public method on the latter; no existing requirement's behavior changes)

## Impact

- New: `schemas/combined-proposal.schema.json`, `backend/src/main/scala/com/helio/api/protocols/
  CombinedProposalProtocol.scala`, `backend/src/main/scala/com/helio/services/
  CombinedProposalService.scala`, `backend/src/main/scala/com/helio/api/routes/
  CombinedProposalRoutes.scala`, `helio-mcp/src/tools/combinedProposal.ts` (+ its handler/validation
  siblings, mirroring HEL-385's file split).
- Modified: `PipelineProposalService.scala` (one new public `rollback` method, additive — no existing
  method's signature or behavior changes), `ApiRoutes.scala` (wire the new service + route),
  `JsonProtocols.scala` (mix in the new protocol trait), `helio-mcp/src/helioApi.ts`/`types.ts`/
  `index.ts`.
- No changes to `ProposalPanel`, `DashboardProposalProtocol`, `DashboardProposalService`,
  `PipelineProposalProtocol`, or any existing `PipelineProposalService` method — every existing proposal
  path (standalone dashboard, standalone pipeline) is byte-for-byte unchanged.
- No migrations.

## Non-goals

- NL authoring of the combined proposal (HEL-341/Claude wiring) — deterministic apply path only.
- Multi-pipeline / multi-source proposals — exactly one pipeline per combined proposal, per the ticket's
  own scope.
- New frontend UI for this flow — the ticket explicitly defers in-app surfacing to HEL-341 ("link, don't
  block"); this ticket ships the backend + MCP capability only.
