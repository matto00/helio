## Why

HEL-1069. Probe-confirmed locally (scenarios A/B/D/E): the helio-mcp `add_pipeline_step` tool cannot create a sibling lane. The backend's default placement for `parentStepId`/`rootId`/no-anchor adds is a SPLICE: the new step becomes the anchor's only child and every existing child of the anchor is silently re-parented under it. `attachAsTail` (sibling, nothing moved) exists on the backend but the MCP tool does not expose it. So the second of two same-root aggregate branches silently becomes the PARENT of the first, which then aggregates the other branch's output: wrong counts (cnt 1,1,1 instead of 2,3,1) or, when a referenced field no longer exists, zeros (`count(amount)` over `(category,total)` gives n=0), all with a 200 clean run. Separately, `run_pipeline` (MCP) drops the `stepRowCounts` the backend already returns, so a zero-row node (e.g. a join whose key types mismatch, probe scenario G) is invisible to the agent.

## What Changes

- Backend `POST /api/pipelines/:id/steps`: new optional request flag `rejectIfReparents` (default absent = today's behaviour, so the editor and patch-sets are unchanged). When `true` and the insert would re-parent one or more existing steps, the request fails 422 with the moved step ids and the two explicit options, and nothing is written. The create RESPONSE (POST only) gains `reparentedStepIds: string[]` reporting any steps a splice moved.
- helio-mcp `add_pipeline_step`: exposes `attachAsTail`. `attachAsTail: true` = new sibling lane; `attachAsTail: false` = deliberate splice-insert; omitted = the tool sends `rejectIfReparents: true`, so any implicit move is a loud error. `rootId` + `attachAsTail:true` is rejected by the tool (the backend rootId path has no sibling semantics). The response passes `reparentedStepIds` through.
- helio-mcp `add_outputs_from_shape`: a `stepId` that already has children branches a sibling (`attachAsTail: true` on the first expanded step, per the tool's documented "branching off stepId"); absent `stepId` sends `rejectIfReparents: true`.
- helio-mcp `run_pipeline`: returns `runId`, `stepRowCounts`, and `warnings[]` flagging any counted step that produced 0 rows from a non-empty input.
- Schemas (`create-pipeline-step-request.schema.json`), docs, README, tool descriptions updated. No migration.

## Capabilities

### New Capabilities
- `mcp-pipeline-step-placement`: explicit, loud, non-silent placement semantics for the MCP step-adding tools.
- `mcp-run-pipeline-step-counts`: per-step row counts and zero-row warnings in the MCP `run_pipeline` result.
- `pipeline-step-reparent-reporting`: backend `rejectIfReparents` guard and create-response `reparentedStepIds`.

### Modified Capabilities

## Impact

`PipelineService.persistNewStep`, `PipelineStepRepository.spliceInsertAtInternal` (return moved ids, abort-before-write mode), `PipelineStepProtocol`/create route, `schemas/pipelines/create-pipeline-step-request.schema.json`, `helio-mcp/src/tools/{write,assertSchemas,pipelinesHandlers}.ts`, `helioApi.ts`, `types.ts`, `docs/agent-native.md`, `helio-mcp/README.md`. Existing specs `pipeline-run-execution` and `patch-set-lane-edits` are NOT changed (their stated behaviour is untouched). Out of scope, filed as follow-up tickets at delivery: `analyze_pipeline` warnings (referenced field missing from a step's inputSchema, join-key type mismatch, output-column collision) and the join `leftRow ++ rightRow` silent column overwrite.
