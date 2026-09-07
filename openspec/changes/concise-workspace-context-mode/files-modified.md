# Files modified — HEL-865

- `helio-mcp/src/context.ts` — added `WorkspaceContextTruncation.omittedDetailKinds` (always
  present, empty for full mode); threaded an opt-in `concise` param through
  `buildWorkspaceContext`; `applyBudget` now sets `truncation.applied` from a passed-in
  `omittedDetailKinds` list instead of hardcoding `false`; concise mode replaces each pipeline
  step's `outputColumns` with `outputColumnCount` and each data source's `inferredSchema` with
  `inferredSchemaFieldCount`, retaining every entity and every Output's `schema` in full.
- `helio-mcp/src/types.ts` — added `ConciseAnalyzeNode`/`PipelineAnalyzeConciseResponse`, mirroring
  the backend's `PipelineAnalyzeConciseResponse` (`{nodes: [{path, op, validationError?}]}`).
- `helio-mcp/src/helioApi.ts` — `analyzePipeline` gained an overloaded `concise` param, forwarded
  as a `?concise=true` query param (mirrors `runPipeline`'s `dry` precedent); absent/false keeps
  the existing return type and request shape unchanged.
- `helio-mcp/src/tools/read.ts` — `analyze_pipeline` and `get_workspace_context` tool input
  schemas gained an optional `concise` boolean, forwarded to the underlying calls; both tool
  descriptions now state size behaviour, the omission rule, and the `analyze_pipeline` fallback for
  omitted per-step columns.
- `helio-mcp/src/context.test.ts` — promoted the throwaway fidelity probe fixture (25
  sources/60 cols, 43 pipelines/7 steps, populated `laneTree`, UUID ids) into the permanent test
  fixture, replacing the old thin 25/43 fixture that could never prove the fix (design.md D1).
  Converted the old under-budget assertions (`:558`/`:559`) into the full-mode-exceeds-budget red
  arm, and added concise-mode assertions: both directions on one fixture, breadth preserved (25
  sources/43 pipelines), content assertions (step column count vs. no column list, Output schema
  survives intact, `inferredSchemaFieldCount`), `truncation.applied`/`omittedDetailKinds`, and
  byte-identical default-vs-explicit-full-mode equality. Added the missing `omittedDetailKinds`
  field to the existing `applyBudget` test fixture's truncation literal.
- `helio-mcp/src/hel865ConciseModes.test.ts` (new) — asserts `HelioApi.analyzePipeline` forwards
  `concise=true` as a query param when requested and omits it entirely when not, via the same
  injected-`fetch` harness `helioApi.test.ts` uses.

## Deleted

- `helio-mcp/src/hel865Fidelity.probe.test.ts` — promoted into `context.test.ts` per task 6.1; not
  left alongside the permanent fixture.

## Deliberately unchanged

- `schemas/workspace/workspace-context.schema.json` — governs the backend `GET
  /api/workspace/context` route this change never touches (design.md D6, tasks 5.1/5.3). Verified
  byte-unchanged via `git diff --stat`.
- `schemas/pipelines/pipeline-analyze-concise-response.schema.json` — already describes the
  backend's concise response; the endpoint itself is unchanged (task 5.2).
