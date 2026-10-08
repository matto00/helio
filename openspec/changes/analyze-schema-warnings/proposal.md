## Why

`analyze_pipeline` is how an agent (or the editor) checks a pipeline before running it, but three schema-visible mistakes pass analyze silently and produce wrong results at run time with a clean run status (HEL-1069 probe): a step that reads a field its input does not carry (an aggregate over a missing column yields n=0), a join whose two key columns have different types (string CSV key vs numeric key: 0 rows, no error), and a join whose two inputs share a non-key column name (the right copy is silently renamed `right_<name>`, so a downstream reference to the bare name reads the left value). All three are detectable from the schemas analyze already projects.

## What Changes

- New pure, schema-only warning pass in a new `domain/engine/AnalyzeSchemaWarnings.scala` (only visibility tweaks in `PipelineAnalyzeService.scala`) over the `analyzeNodes` result, producing three warning classes: `field-not-in-input-schema`, `join-key-type-mismatch`, `join-column-renamed`.
- `PipelineAnalyzeResponse` (`GET /api/pipelines/:id/analyze`) and `PipelineAnalyzeProposalResponse` (`POST /api/pipelines/analyze-proposal`) gain an always-present top-level `warnings` array of `{stepId, code, message}`. The concise analyze shape gains an optional per-node `warnings` array (omitted when empty).
- Warnings are non-blocking: no effect on `validationError`, `costVerdict` (`canRun`, `autoRunnable`, `reasons`), the HEL-1279 dataset-write auto-run gate (`stepConfigProblem`), or any write path.
- JSON Schemas under `schemas/pipelines/`, helio-mcp types and tool descriptions, and frontend analyze types updated in the same change. No frontend rendering of warnings, no `get_workspace_context` surfacing, no `lookup` key type check (out of scope; follow-ups).

## Capabilities

### New Capabilities
- `pipeline-analyze-schema-warnings`: schema-only, non-blocking analyze warnings for missing referenced fields, join-key type mismatches, and join column renames, on the persisted, proposal and concise analyze responses and their MCP tools.

### Modified Capabilities
<!-- none: the existing analyze specs' requirements are unchanged; the new field is additive and specified by the new capability -->

## Impact

- Backend: new `domain/engine/AnalyzeSchemaWarnings.scala` (warning pass), `domain/engine/PipelineAnalyzeService.scala` (visibility-only tweaks to reuse the lane/source-dependency helpers), `api/protocols/pipelines/PipelineAnalyzeProtocol.scala` + `PipelineAnalyzeProposalProtocol.scala` (wire types/formats), `services/pipelines/PipelineService.scala` (analyze, analyzeConcise, analyzeProposal wiring).
- Contract: `schemas/pipelines/pipeline-analyze-response.schema.json`, `pipeline-analyze-proposal-response.schema.json`, `pipeline-analyze-concise-response.schema.json`.
- helio-mcp: `src/types.ts`, `analyze_pipeline` / `analyze_pipeline_proposal` tool descriptions.
- Frontend: analyze response types only.
- No migration, no new dependency, no write-path change. Adjacent: HEL-1403 (numeric-function-on-string warning) can reuse this warnings channel; HEL-1267 (same file) is queued after.
