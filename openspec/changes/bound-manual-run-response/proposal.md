## Why

HEL-1660 and HEL-1679 bound a run's memory to the 192 MB per-run share (25% of the 768 MB prod heap), but the
heap measurement stops when the service returns. The HTTP layer then renders the whole `RunResultResponse` (every
terminal row) to one JSON string and one byte buffer at once. Measured (see measurements.md): on HEL-1679's `fewrows-utf16-200` that render pushes a real run to 233-414 MB,
over the share. `rowwidth-at-limit` stays under it (its 16 MB body's render transient is below the run's own walk peak) but is
measured too.

## What Changes

- Responses that carry a run result (`POST /api/pipelines/:id/run[?dry=true]`, `POST /api/pipelines/apply-proposal`,
  `POST /api/proposals/apply`) are written as a chunked stream of compact JSON, one bounded piece at a time, instead
  of one fully rendered string. The bytes on the wire are identical to today's compact JSON.
- The run-path heap measurement is extended through the response render, so the share covers what a manual run
  holds until its last byte is written.
- No field, row, count or status changes. No limit changes. No client changes.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-run-memory-bounds`: adds a requirement that a run's HTTP response stays within the per-run share and
  keeps today's JSON content.

## Non-goals

- Capping the rows a run response returns. The ticket suggests it, but the MCP `apply_pipeline_proposal` /
  `apply_combined_proposal` tools pass `run.rows` to agents verbatim and the live spec promises "all" rows, so a cap is
  client-visible and needs an owner ruling. Listed as a follow-up candidate.
- Changing the preview endpoints (already capped at 10 rows).
- Changing any run limit in `RunLimits`.

## Impact

- Backend: a streaming JSON marshaller, wired into the run, apply-proposal and combined-apply routes.
- Tests: `RunPathHeapSpec` (opt-in measurement) and new route / printer-equivalence specs.
- Frontend, helio-mcp, helio-news: none (identical body; `Content-Length` replaced by chunked transfer).
