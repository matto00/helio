## Why

HEL-1693 made run and apply responses chunked. Google's Cloud Run quotas page says the 32 MiB HTTP/1 response limit
"applies if not using `Transfer-Encoding: chunked` or streaming", so nothing now stops a very large terminal frame
from reaching the browser or an MCP agent in full. No consumer needs every row: the web client only counts them.

## What Changes

- `POST /api/pipelines/:id/run[?dry=true]`, `POST /api/pipelines/apply-proposal` and `POST /api/proposals/apply`
  return at most the first 10 terminal rows in `rows` (owner ruling, 2026-11-20). `rowCount` stays the total, and a new
  boolean `rowsTruncated` is `true` exactly when `rowCount` exceeds the rows returned. **BREAKING** for any caller that
  read every row from `rows`.
- `POST /api/pipelines/:id/preview` (already `take(10)`) reports `rowsTruncated` honestly through the same helper.
- `GET /api/pipelines/:id/runs/:runId` (Spark-only cache) is capped the same way: `rows` at most 10, `rowCount` the
  total, `rowsTruncated` set.
- Web client: the run status chip counts from `rowCount`, not `rows.length`; run state stops holding rows it never
  reads; the stale `pipelinesState.ts` comment goes.
- MCP `apply_pipeline_proposal` / `apply_combined_proposal` pass the capped run through unchanged; their types and tool
  descriptions say `run.rows` is a preview of at most 10 rows, `rowCount` the total, `rowsTruncated` the cut.
- Server-to-client and server-to-MCP seam tests through a shared fixture written by the real route.

## Capabilities

### New Capabilities
- `pipeline-run-response-preview`: the 10-row preview, `rowCount`, `rowsTruncated` contract on every run-result
  response, the web client and the MCP apply tools.

### Modified Capabilities
- `pipeline-run-execution`: the no-steps and dry-run scenarios no longer promise all rows in the response.
- `pipeline-run-memory-bounds`: the chunked-response requirement no longer requires `rows` to hold every row.
- `pipeline-run-status-access`: the run status response carries the capped preview.
- `mcp-pipeline-proposal-tools`: `apply_pipeline_proposal` documents the capped run result.

## Non-goals

- No change to what a run computes or writes (snapshots, history, Output rows are unaffected).
- No MCP redeploy and no prod probe (the owner redeploys MCP at release time).
- No change to `POST /api/pipelines/:id/draft-preview` (already capped at 1,000 rows) or `GET /api/outputs/:id/rows`.
- helio-news needs no change: it calls only `run_pipeline`, which already returns counts without rows.

## Impact

Backend run/preview/proposal response construction, `RunResultResponse`/`CachedRunStatus` protocols, frontend
`pipelinesSlice`/`SpineRunStatus`/run types, `helio-mcp` types and tool descriptions, specs listed above.
