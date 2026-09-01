## Why

P1.1-P1.3 built the Outputs model, engine, and API surface on `main`, but
helio-mcp still speaks the old DataType/Metric/panel-binding vocabulary and
the proposal/patch-set contracts still ground against DataType schemas. This
is the row that retargets the agent-facing surface (helio-mcp) and both
sides of the proposal/patch-set contract onto Outputs, closing the last gap
before the frontend rows (P1.5/P1.6) can build on a consistent model.

## What Changes

- **BREAKING**: helio-mcp tool surface rewritten onto Outputs. Changed:
  `create_pipeline` (single-call, sourceId or inline source, `steps[]` with
  `parentStepId`, optional `outputs[]`), `add_pipeline_step` (+`parentStepId`),
  `create_pipeline_from_shape` -> `add_outputs_from_shape`,
  `create_panel`/`create_panels`/`bind_panel`/`create_bound_panel` ->
  `place_outputs` + `create_content_panel`, `update_panel` (placement fields
  only), `get_panel_capabilities` -> `get_output_capabilities`,
  `get_workspace_context` (drops types/metrics, lists pipeline outputs +
  source `inferredSchema`).
- New tools: `add_output`, `update_output`, `delete_output`, `list_outputs`,
  `get_output_rows`, `preview_outputs`.
- **BREAKING**: removed, no aliases: `list_data_types`, `update_data_type`,
  `delete_data_type`, `get_data_type_rows`, `list_metrics`, `get_metric`,
  `create_metric`, `update_metric`, `delete_metric`, `bind_panel`,
  `create_bound_panel`, `get_panel_capabilities`.
- `teardown_resources`/tag semantics cover Outputs (inherit pipeline's tag).
- Decompose `write.ts`/`helioApi.ts`/`context.ts` by resource; fixes the root
  Jest/ts-jest OOM on importing `write.ts` (HEL-647).
- **BREAKING**: `DashboardProposal`/`PipelineProposal`/combined/patch-set
  schemas and services retarget onto pipelines (steps+outputs) and
  dashboards (placements+content panels); Output `fieldMapping` grounds
  against the per-node projected schema.
- Split `WorkspaceContextService`; patch-set inverse builders rewritten for
  nodes/outputs/placements (`enabled` preserved); refinement targeting
  re-verified for Outputs; review pages render Output previews.
- Absorbs as part of this change: HEL-882, HEL-658, HEL-648, HEL-647,
  HEL-631, HEL-766, HEL-848. Retargets (not absorbs): HEL-641, HEL-640
  (own tickets, blocked on P1.7). Closes the helio-mcp share of HEL-934.

## Capabilities

### New Capabilities

- `mcp-output-tools`: `add_output`/`update_output`/`delete_output`/
  `list_outputs`/`get_output_rows`/`preview_outputs`/
  `get_output_capabilities`/`place_outputs`/`create_content_panel`/
  `add_outputs_from_shape` — the Output-centric MCP tool surface.

### Modified Capabilities

- `mcp-metric-tools`: metric tools removed outright, no aliases.
- `mcp-panel-composition-tools`: retarget from panel/binding tools to
  `place_outputs`/`create_content_panel`/`update_panel`.
- `mcp-pipeline-shape-tools`: `create_pipeline_from_shape` ->
  `add_outputs_from_shape`.
- `mcp-pipeline-proposal-tools`, `mcp-patch-set-tools`: retarget onto
  Outputs/placements in both request and response shape.
- `workspace-context-agent-section`, `workspace-context-assembly`: drop
  types/metrics, add Output-oriented summaries under the MCP result cap.
- `pipeline-proposal-contract`, `pipeline-proposal-apply`,
  `pipeline-proposal-analyze-api`, `pipeline-proposal-review-ui`,
  `nl-dashboard-proposal-authoring`: retarget proposal/patch-set schemas and
  grounding onto Outputs/placements, per-node projected-schema validation.
- `patch-set-contract`, `patch-set-apply`, `patch-set-undo`,
  `patch-set-preview`: inverse builders for nodes/outputs/placements;
  `PipelineStep.enabled` preserved through rollback/recreate (HEL-766 —
  Outputs have no `enabled` field).
- `refinement-chat-surface`: chart-create-with-implied-Output must not
  mistarget a follow-up edit (re-verify HEL-670 against the new model).
- `output-panel-placement`, `output-routes-api`, `outputs-model`: extend for
  `teardown_resources` tag-cascade and any MCP-driven gaps found in P1.3.

## Impact

`helio-mcp/src/**` (near-total rewrite of `tools/`, `helioApi.ts`,
`context.ts`, `index.ts`, `types.ts`); `schemas/dashboards/dashboard-proposal*`,
`schemas/pipelines/pipeline-proposal*`, `schemas/patch-sets/*`;
`backend/.../proposal/**`, `.../patchset/**`, `WorkspaceContextService` and
its split; `frontend/.../ProposalReviewPage` and sibling review pages;
`docs/agent-native.md`. Blocks P1.5/P1.7; partially closes HEL-934.

## Non-goals

Frontend pipeline page and dashboard picker (P1.5/P1.6); branching in
proposals (P2.4); SSE/BroadcastChannel invalidation registries (HEL-641/640,
own tickets); UI visual polish beyond what the review-page rewrite requires.
