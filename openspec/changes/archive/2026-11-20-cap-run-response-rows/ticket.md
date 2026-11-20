# HEL-1696: Cap rows returned by manual run / apply-proposal responses (preview + rowCount); verify Cloud Run 32 MiB limit vs chunked responses

## Description

Follow-up to HEL-1693 (PR #1085). HEL-1693 streams `RunResultResponse` as chunked JSON, so the server no longer buffers the whole frame. But the response still carries every row of the terminal frame. Cloud Run's 32 MiB response limit may apply only to buffered responses; that is unverified. If so, a very large manual run that used to fail in prod would now arrive in full, possibly tens of MB parsed in the browser.

## Do

1. Verify Cloud Run's behaviour for chunked responses over 32 MiB.
2. Cap the rows returned by `POST /api/pipelines/:id/run[?dry=true]`, `POST /api/pipelines/apply-proposal` and `POST /api/proposals/apply`, for example to a preview's worth plus `rowCount` and `truncated`.
3. Update the `pipeline-run-execution` spec ("all rows"), the MCP `apply_*` tools (which pass `run.rows` to agents), and the frontend fallback in `SpineRunStatus.tsx:29-35` (use `rowCount`). Fix the stale comment at `pipelinesState.ts:44`.
4. Check the Spark-only `GET /api/pipelines/:id/runs/:runId` (`PipelineRunQueries.scala:71-76`), which also returns full rows.

The exact cap and the change to the MCP contract are owner calls.

## Acceptance Criteria

- The Cloud Run behaviour is documented.
- The cap is applied with seam tests on both client and server.
- MCP and helio-news are unaffected or updated.
