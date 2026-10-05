## Context

L3 (HEL-1273) serves `GET /api/outputs/:id/history?limit=1..100(default 30)&since=<ISO instant>`
(`backend/.../routes/pipelines/OutputRoutes.scala` `path("history")`, wire shape in `OutputHistoryProtocol.scala`).
The response is `{outputId, compare, current, baseline, delta, pct, availableFrom, sparkline[], points[]}`.
`points` are newest first and carry `{capturedAt, runId, triggerSource, rowCount, summary}`. `sparkline` is oldest
first and carries `{capturedAt, value}`. `since` filters the newest-`limit` points *after* `limit` is applied
(`OutputHistoryService.forOutput`), so it narrows rather than pages back. `value` comes from `summary.metric.value`,
which `OutputSummaryReducer.summarize` sets only for `OutputKind.Metric`, so every other kind gets `null`. A
`previous_run` baseline is `recent.lift(1)`, the second-newest *retained* point. L2 thinning (purge on the scheduler
tick, `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES`, default 60) can make that older than the prior run. HEL-1285 owns the
final semantics. `config.compare` is already validated server-side on add/update (`OutputService.validateConfig`) and
on single-call create and proposal grounding (`PipelineService.validateOutputFieldMapping`).

helio-mcp tools follow a thin-shell split: zod plus `registerTool` in `src/tools/outputs.ts`, and plain async
pass-through handlers in `outputsHandlers.ts` calling one `HelioApi` method each (`src/helioApi.ts`, e.g.
`getOutputProvenance`). `server.test.ts` pins the full sorted `EXPECTED_TOOL_NAMES`. `scripts/verifyPayloads.ts` holds
pure builders for every payload verify sends, and `verifyPayloads.test.ts` drives them through the real server with a
stub API.

## Goals / Non-Goals

**Goals:** one-call history read for agents. `compare` is discoverable on every Output-config write tool. A live
30-value proof is in place.
**Non-Goals:** backend, migration, `ci.yml` and `package.json`/lockfile changes. Client-side `compare` validation is
also out, and so is any change to `place_outputs`.

## Decisions

**D1 Pass-through, not re-implementation.** Add `HelioApi.getOutputHistory(outputId, {limit?, since?})`, which issues
one GET and adds query params only when defined (mirroring how existing optional params are omitted).
`getOutputHistoryHandler` returns its result. No baseline, delta or value arithmetic happens in helio-mcp. The
alternative, reading `get_output_rows` repeatedly, was rejected: it only ever sees the latest snapshot.

**D2 Trim `points[].summary` by default (`includeSummaries` opt-in).** A chart summary carries up to 200 series points
plus up to 20 column stats. Thirty of those runs to roughly 100KB+ of JSON per call, which an agent asking for "the
last 30 values" does not need, since `sparkline` already holds the values. The handler drops `summary` from each point
unless `includeSummaries === true`, and leaves everything else byte-identical. This is a field omission, not a
recomputation, so D1 holds. Rejected: always-full (token cost) and a server-side param (backend change, out of scope).

**D3 Input schema.** `outputId: z.string().min(1)`, `limit: z.number().int().min(1).max(100).optional()` (mirrors the
backend bound so an agent gets the error locally; the backend stays authoritative),
`since: z.string().min(1).optional()` (no client-side date parsing, because the backend `Instant.parse` decides), and
`includeSummaries: z.boolean().optional()`.

**D4 Honest description.** It must say that `value`, `current.value`, `baseline.value`, `delta` and `pct` are non-null
only for metric Outputs. Other kinds should use `points[].rowCount`, or `summary` via `includeSummaries`. It must say
that `previous_run` compares against the second-newest *retained* point, and that older history is thinned so this
may be earlier than the last run. It must say that `baseline` null with `availableFrom` means the window isn't covered
yet, that `since` narrows the newest `limit` points rather than paging back, and that only real successful runs
record history. It must state the status codes, mirroring `get_output_provenance`: 400 bad limit/since, 404 unknown
or no access, 401. The literal phrase "previous run" must not appear; a test asserts its absence.

**D5 `compare` documentation.** Add one shared exported string constant, `COMPARE_CONFIG_DOC` in `outputs.ts`, and
append it to the `add_output`, `update_output` (noting `compare` is replaced outright, not deep-merged, and that null
clears it), `create_pipeline` and `propose_pipeline` descriptions. The constant documents the values, the null case,
the 400 on anything else, and that `previous_run` means the second-newest retained point. One constant means one
place to change when HEL-1285 settles. `config` stays `z.record`: client validation would fork the backend's
`OutputCompare` grammar. In `schemas/`, add the same `compare` property (description plus the pattern copied verbatim
from `schemas/outputs/create-output-request.schema.json`) to
`schemas/pipelines/create-pipeline-transactional-output-request.schema.json`'s `config`. The pipeline-proposal schema
`$ref`s it, so both are covered. `place_outputs` (placements.ts) is not touched.

**D6 Verify harness.** New pure builders in `verifyPayloads.ts`: `buildAddMetricOutputCall(pipelineId, runId)`
(`add_output`, kind `metric`, `config: {fieldMapping: {value: "revenue"}, aggregation: {agg: "sum"}, compare:
"previous_run"}`, which are the keys `OutputSummaryReducer.metric` reads; the executor confirms the backend accepts
them with a live 201 and does not guess) and `buildGetOutputHistoryCall(outputId, limit)`. Both are registered
in `VERIFY_WRITE_BUILDERS` (or a sibling list the drift test iterates), and the stub API gains `getOutputHistory`.
`verify.ts` adds the metric Output to its existing fixture pipeline, then calls `run_pipeline` (real) until 30 runs
have succeeded. `HelioHttpClient` already retries a 429 a bounded number of times (HEL-495). If a 429 still surfaces as an `isError`
result (the default is 10 runs/min/user), verify waits (a fixed 15s backoff, since the tool text carries no header) and
retries,
with a hard overall cap (e.g. 6 min) that fails non-zero. It then makes ONE `get_output_history {limit: 30}` call,
prints the 30 `capturedAt → value` pairs, and asserts `points.length === 30` and 30 numeric sparkline values. Teardown
is unchanged: the pipeline is deleted by exact id, the Output cascades, and its history cascades (FK ON DELETE
CASCADE, D8).

**D7 Live evidence run.** Use a freshly built `helio-mcp/dist` in the worktree (`npm run build` then `npm run verify`),
against the worktree's own backend on its allocated port (9613). Never use the session's MCP tools. For that backend
process only, set `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES` high (e.g. 1440) so its own startup-tick purge (the first
tick always claims) can't thin the 30 points mid-run. `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` may be raised too, purely
for speed. Record the exact env in the evidence.

## Risks / Trade-offs

- [Shared dev DB: another backend's purge thins all Outputs' history, collapsing 30 fresh points to ~1] → verify reads
  immediately after the 30th run, and on fewer than 30 it fails naming the count and thinning as the likely cause.
  The executor reruns rather than weakening the assertion.
- [The description goes stale when HEL-1285 decides] → one shared constant plus the D4 sentence. Both are flagged in
  the HEL-1285 follow-up note.
- [`includeSummaries` default hides data an agent may want] → it is documented in the description, and one flag
  restores it.

## Migration Plan

None. No migration, no backend change, no new dependency. Rollback is reverting the commit.

## Planner Notes

- Self-approved: D2's default trim, D3's client-side `limit` bound, and documenting on `propose_pipeline` only. The
  analyze/apply tools share the same `pipelineProposalOutputSchema`, and their descriptions already point at
  `propose_pipeline`'s shape. The executor adds the doc there too only if a tool description re-describes `outputs[]`.
- Unit tests live in `helio-mcp/src/**/*.test.ts` (Jest). Grep showed no repo-root `e2e/` spec touching helio-mcp or
  history, so none is needed. `helio-mcp/e2e/*.ts` are scripted demos and untouched.
