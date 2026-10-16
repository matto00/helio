## Why

One `get_workspace_context` call sends 4 GETs per pipeline plus 1 per Output: 339 requests on a 55-pipeline /
110-Output fixture (measured), with up to 220 in flight. That exceeds the default 120 requests / 60 s per-principal
rate limit by itself, so the tail of the call is throttled (HEL-1617 stopped that from crashing helio-mcp; it did
not cut the volume). The owner chose option B on 2026-10-16 (escalation `HEL-1619-1792162665086-c148d1`).

## What Changes

- New additive backend read `GET /api/pipelines/context-details`: for every pipeline the caller sees in
  `GET /api/pipelines`, its steps (same element shape as `GET /api/pipelines/:id/steps`) and its latest run's
  assertion summary (same value as `run-history[0].assertions`), in ONE response. JSON schema in the same change.
  No existing response changes.
- helio-mcp `buildWorkspaceContext` uses that read for `laneTree` and `lastRunAssertions` instead of 3 per-pipeline
  GETs, falling back to today's per-pipeline calls when the read is unavailable (404 on an older server, or any
  other failure) or omits a pipeline.
- helio-mcp skips `GET /api/outputs/:id/panels` for an Output whose `GET /api/outputs` item reports
  `panelCount: 0` (calls it as today when `panelCount` is absent).
- helio-mcp caps in-flight requests for the remaining fan-outs with a small ordered pool.
- The MCP payload stays byte-identical (apart from `generatedAt`). Expected cost at 55 pipelines: ~84 requests.

## Capabilities

### New Capabilities
- `pipeline-context-details-read`: the batched per-pipeline steps + latest-run assertions read.
- `mcp-workspace-context-request-budget`: the request-count and concurrency bound of `get_workspace_context`, and
  its byte-identical payload guarantee.

### Modified Capabilities

## Impact

- Backend: `PipelineRoutes` (new literal path before the `PipelineIdSegment` branches), `PipelineService` /
  run-query batch reads, `JsonProtocols`, `schemas/pipelines/`. No migration expected.
- helio-mcp: `context.ts`, `contextControls.ts` (unchanged contract), `helioApi.ts`, `types.ts`, tests.
- helio-mcp `dist/` is gitignored and not rebuilt by a merge; consumers (helio-news) keep the old behaviour until
  it is rebuilt.

## Non-goals

- Batching `GET /api/pipelines/:id/analyze` (stays one per pipeline, so cost remains O(pipelines)).
- Any change to the default or concise MCP payload, or to any existing backend response.
- Client-side rate pacing across separate tool calls.
