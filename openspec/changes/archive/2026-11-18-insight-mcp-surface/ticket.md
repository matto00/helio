# HEL-1747: Insight L8: MCP surface (insight kind, get/refresh insight, ask_dashboard)

## Description

Leaf of HEL-921 (narrative insight Outputs + ask-your-data over snapshots). Depends on L1 (HEL-1740), L4 (HEL-1743)
and L6 (HEL-1745), all merged on main.

**Changes:**

* Add `insight` to the kind enums and descriptions in `create_pipeline`, `add_output`/`update_output` and
  `propose_pipeline`.
* New tools: `get_output_insight`, `refresh_insight` and `ask_dashboard(dashboardId, question)`.
* Add a test that `place_outputs` places an insight Output unchanged. The tool doesn't care about kind, so it should
  need no code change.

Note: merges don't rebuild the session MCP's `dist`, and the hosted connector at mcp.helioapp.dev is redeployed by
`deploy-mcp.sh`, not by a release. Both are owner prod steps, outside this ticket.

## Acceptance Criteria

* New helio-mcp tests that fail first.
* The epic's agent exit criterion is scripted end to end against a fake-model backend: an agent adds an insight Output
  to an existing pipeline, gets a cited narrative, and asks a question on a dashboard.
* `audit-ci` stays green.

## Migration

None.

## Agent notes (re-derived 2026-11-18 against main 42b0b2f3d)

* Kind enums: `helio-mcp/src/tools/outputs.ts:55` (`outputKindSchema`, add_output), `pipelines.ts:152`
  (add_outputs_from_shape `outputKind`), `pipelineProposal.ts:89` (`pipelineProposalOutputSchema`, reused by
  create_pipeline and propose_pipeline), `types.ts:1106` (`PipelineProposalOutput.kind`).
* `placements.ts` `place_outputs` takes `outputId` only (kind-agnostic).
* Backend routes this surface wraps (CLAUDE.md, ApiRoutes.scala): `GET /api/outputs/:id/insight` (role-shaped,
  R3/R3b), `POST /api/outputs/:id/insight/refresh` (202 `{outputId, started}`, owner/editor, optional
  `{"trigger":"pin"}`, `INSIGHT_REFRESH_RATE_LIMIT_PER_WINDOW`), `POST /api/dashboards/:id/ask` (server
  `CLAUDE_MODEL`, no model field). Insight config `model` key (R1) per HEL-1743.
* Driver constraints: no live model call; no MCP dist rebuild or deploy-mcp.sh; no Flyway expected.
