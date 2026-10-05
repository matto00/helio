## Why

L3 (HEL-1273) shipped `GET /api/outputs/:id/history` — newest-first points, a sparkline, and the resolved
`config.compare` baseline/delta — but agents cannot reach it: helio-mcp has no history tool, and no write tool tells an
agent that `config.compare` exists. The HEL-918 exit criterion requires an agent to get the last 30 values of any
Output in one MCP call.

## What Changes

- New helio-mcp tool `get_output_history` (`outputId`, optional `limit` 1..100, optional `since`, optional
  `includeSummaries`): a pass-through of the L3 route. By default it drops each point's bulky `summary`. Its
  description is honest about two things: `value` is non-null only for metric Outputs, and a `previous_run` baseline
  is the second-newest *retained* point (thinning can make it older than the last run).
- `config.compare` documented in the `add_output`, `update_output`, `create_pipeline` and
  `propose_pipeline`/`analyze_pipeline_proposal`/`apply_pipeline_proposal` descriptions. It is also documented on
  `schemas/pipelines/create-pipeline-transactional-output-request.schema.json`, which the pipeline-proposal schema `$ref`s. `place_outputs` is untouched. The backend stays
  the sole validator.
- `scripts/verify.ts` + `verifyPayloads.ts`: add a metric Output with `compare`, run it 30 times, and read 30 values
  in one `get_output_history` call.
- README tool list updated.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mcp-output-tools`: adds the `get_output_history` tool and the `compare` documentation requirement.
- `mcp-verify-harness`: the harness proves a 30-value history read in one call.

## Non-goals

- No backend, schema-validation, migration, CI-workflow or dependency change.
- No client-side `compare` validation (that would duplicate the backend grammar).
- No history UI (L5), payloads (L6), or "previous" semantics change (HEL-1285).

## Impact

helio-mcp `src/tools/outputs.ts`, `outputsHandlers.ts`, `pipelines.ts`, `pipelineProposal.ts`, `src/helioApi.ts`,
`src/types.ts`, tests, `scripts/verify*.ts`, README; `schemas/pipelines/` (description-only).
