# HEL-549: Metric grounding — workspace-context catalog + proposal binding

## Description

For the agent to COMPOSE defined metrics (the epic's central quality lever), it must (a) SEE the metric catalog in its grounding snapshot and (b) be able to BIND a panel to a `metricId` in a proposal. Today `helio-mcp/src/context.ts` (`buildWorkspaceContext`) grounds sources/DataTypes/pipelines/dashboards but has no metric awareness, and `propose_dashboard`/`apply_proposal` (`helio-mcp/src/tools/proposal.ts` + `DashboardProposalService.scala`) only bind panels via `dataTypeId`.

## Scope

- Grounding: extend `WorkspaceContext` (`helio-mcp/src/context.ts`) with a `metrics` array (id, name, boundDataTypeId, measureField, aggregation, allowedDimensions, format, deprecated), fetched via the 418-B list endpoint. Update the `get_workspace_context` tool description in `read.ts`.
- Proposal wire: add an optional `metricId` to `ProposalPanel` — both the MCP `panelSchema` (`helio-mcp/src/tools/proposal.ts`) and the backend `ProposalPanel` protocol — and thread it through `DashboardProposalService` (`buildDataConfig`/`buildCreateRequest`) so a proposed panel binds to a metric, reusing the 418-C `metricId` panel-config path. Update `schemas/dashboard-proposal.schema.json`.
- Validation: `propose_dashboard`'s read-only check and `DashboardProposalService.preValidateBindings` must validate a `metricId` resolves to a caller-owned metric (warn/reject a deprecated or non-existent metric), alongside the existing dataTypeId checks.
- No FQNs inlined in Scala.

## Acceptance Criteria

- [ ] `get_workspace_context` includes a `metrics` catalog for the authenticated user.
- [ ] A proposal panel may specify `metricId`; `apply_proposal` creates a panel bound to that metric (via the 418-C config path), and nothing is created if the `metricId` is invalid.
- [ ] `propose_dashboard` returns a warning for a `metricId` that is missing/deprecated/non-owned; `applyReady` reflects it.
- [ ] `schemas/dashboard-proposal.schema.json` updated and validated; existing proposals without `metricId` behave exactly as before.
- [ ] `sbt test` + helio-mcp build/tests pass; no FQNs inlined.

## Out of Scope

- Metric authoring UI (418-F) and governance (418-G).

## Dependencies

- Blocked by 418-B (HEL-493: Metric CRUD service + REST routes) and 418-C (HEL-500: Panel binding to a metric (metric -> panel)). Both are shipped on main (see commits a0effb0c / 96bee9ad).
- Relates to Richer Agent Grounding (HEL-345) and Smart Pipeline Shapes (HEL-337).
