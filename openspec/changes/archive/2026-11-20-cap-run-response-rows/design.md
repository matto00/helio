## Context

See proposal.md (Why). Owner rulings for this change, recorded 2026-11-20 as `escalation.answered` in
`.concertino/runs/HEL-1696/events.jsonl`: cap = 10 rows; MCP apply tools pass the capped preview through;
`GET /api/pipelines/:id/runs/:runId` is capped the same way in this ticket; the flag is named `rowsTruncated`.

Current state (main `fef01cda9`):
- `RunResultResponse(rows: Vector[JsObject], rowCount: Int, ...)` (`api/protocols/pipelines/PipelineProtocol.scala:280`).
  Built at `PipelineRunExecutor.scala:361` (`jsRows, jsRows.size`, every terminal row), at
  `PipelineRunService.scala:250` (empty, never-attempted run), and at `PipelineRunPreview.scala:208` and `:296`
  (`allJsRows.take(10)`, `rowCount = allJsRows.size`, no flag). Every other run caller (scheduler, auto-run, hooks,
  draft save) reads only `runId`/`blocked`, never `rows` (`grep` of `services/`).
- `PipelineProposalService` embeds the executor's `RunResultResponse` unchanged as `run` in
  `PipelineProposalApplyResponse`; the combined apply embeds that. All three routes render through
  `RunResponseMarshalling.chunkedJson` (HEL-1693).
- `PipelineRunQueries.runStatus` renders `entry.rows` in full into `CachedRunStatus(rows, rowCount = rows.size)`.
- Web: `submitPipelineRun.fulfilled` stores `payload.rows` in `runResult`; its only reader is `SpineRunStatus`
  (`runResult.length`). The two apply review pages never read `run`. `fetchRunStatus` has no caller.
- MCP: `run_pipeline` already reshapes to counts. `apply_pipeline_proposal` (`/api/pipelines/apply-proposal`) and
  `apply_combined_proposal` (`/api/proposals/apply`) return the backend body. (`apply_proposal` is the dashboard-only
  apply and carries no run.)

## Goals / Non-Goals

Goal: a bounded run-result body on every endpoint that carries one, with an honest total and an explicit cut flag.
Non-goal: anything about what a run computes or persists; the 100,000-row node limit and memory budget are unchanged.

## Decisions

**D1. Cap in the service, through one helper, not in the marshaller.** Add `RunResultResponse.PreviewRows = 10` and a
companion `RunResultResponse.preview(allRows: Vector[JsObject]): (Vector[JsObject], Int, Boolean)` (or an equivalent
single helper) returning `(allRows.take(10), allRows.size, allRows.size > 10)`. Use it at the executor (`:361`) and at
both preview sites (replacing the literal `take(10)`; `:296` also serves `GET /api/pipelines/:id/steps/:stepId/preview`), so every `RunResultResponse` that carries rows gets the flag
from one definition. Add `rowsTruncated: Boolean = false` to `RunResultResponse`; spray-json writes it always (it is a
plain `Boolean`, not an `Option`), so the field is present on every body (`jsonFormat11` becomes `jsonFormat12`). Alternative rejected: capping inside
`RunResponseMarshalling` would cover the three routes, but the apply responses embed `run` in a larger object, the
marshaller is deliberately content-neutral (HEL-1693), and a service-level cap also stops internal callers from
carrying the full JSON row vector in the response object at all.

**D2. The full `jsRows` still feeds the writes.** Only the response value changes; the snapshot/history/write-back
paths keep the full vector they use today. The executor must take the preview from the same `jsRows` after it has been
handed to the terminal writes, never truncate the vector those writes receive.

**D3. `rowCount` is the terminal frame's total row count**, as today. `rowsTruncated == (rowCount > rows.size)`.

**D4. Run status (`GET /runs/:runId`)**: the cap must reach the wire, not stop at the service projection.
`CachedRunStatus` gains `rowsTruncated: Option[Boolean]` (absent when the run has no rows yet, like `rows`/`rowCount`);
`rows` is the first 10 rendered entries (render only those 10, not all then take), `rowCount` stays
`entry.rows.map(_.size)`. `RunStatusResponse` (`PipelineProtocol.scala:143`) gains the same field, written and read by
its hand-written format (`:375-397`, omitted when `None` like its siblings), and the route translation at
`PipelineRunStatusRoutes.scala:34` copies it. The frontend `RunStatusResponse` TS type (`types/pipelineStep.ts:740`)
gains optional `rowCount` and `rowsTruncated` so the type matches the wire, even though `fetchRunStatus` has no caller.

**D5. Web client.** Add `rowsTruncated` to both `RunResult` TS types: required (`boolean`) in `types/output.ts`, optional (`rowsTruncated?: boolean`) in
`services/pipelineService.ts`, matching its optional sibling fields and D6's older-server tolerance (and sparing ~20 test mocks of `runPipeline`). Add `runRowCount: number | null` to `PipelinesState`, set from `payload.rowCount` in
`submitPipelineRun.fulfilled`, cleared wherever `runResult` is cleared. `SpineRunState` replaces `runResult` with
`runRowCount`; the fallback becomes `run.sseRowCount ?? run.runRowCount` (null still means "not claimed" for a
Save & run). Keep the existing `runResult` state key (now the ≤10-row preview) to avoid touching ~20 test files that
preload it and that HEL-1661 also edits; rewrite its stale comment to say what it holds and that nothing reads it for
counting. Thread `runRowCount` through `usePipelineOwnPipeline` → `usePipelineDetailPage` →
`PipelineSpineLayout`/`MobilePipelineHeader` (one-line edits).

**D6. MCP.** `helio-mcp/src/types.ts` `RunResultResponse` gains `rowsTruncated?: boolean` (optional so the client
tolerates an older server, said in the doc comment) and a doc comment stating `rows` is at most a 10-row preview and
`rowCount` the total. `apply_pipeline_proposal` and `apply_combined_proposal`
tool descriptions add one sentence saying the same and pointing agents at `get_output_rows` for the full data. Handlers stay pass-through (owner ruling). No deploy.

**D7. Seam tests through a shared fixture.** A backend route spec runs a real pipeline with more than 10 terminal rows
through `POST /api/pipelines/:id/run` and writes/asserts the body against
`shared-test-fixtures/pipeline-run/run-capped-response.json` (same pattern as `AskSeamSpec`: the body is normalised
first, `runId` and generated step ids in `stepRowCounts` replaced by fixed placeholders, an env flag regenerates the
fixture, and the spec fails if the normalised body and the fixture differ as whole JSON values). The frontend test feeds that fixture through `submitPipelineRun.fulfilled` and
renders `SpineRunStatus`, asserting the chip shows `rowCount` (not 10). An MCP test feeds the same fixture (as the
`run` of an apply response) through the apply handler and asserts `rowCount`/`rowsTruncated` reach the agent intact.

## Risks / Trade-offs

- [Backend tests read `/run` response rows to check step semantics with more than 10 rows] → each such assertion is
  moved to the persisted Output rows (`GET /api/outputs/:id/rows`) or a `rowCount` check; never weaken an assertion to
  fit 10 rows without saying so in the commit. The executor lists every such test it changed.
- [A third-party caller relied on every row] → BREAKING noted in the PR; the full data stays available through the
  Output rows route. MCP needs a redeploy at release time (owner).
- [Merge conflict with HEL-1661] → limited to adjacent lines in `usePipelineDetailPage.ts`, its keys test, and
  the two layout files; resolved at merge-from-main.
- Cloud Run (docs, not probed per C8): quotas page, "Maximum HTTP/1 response size | 32 MiB | ... Limit applies if not
  using `Transfer-Encoding: chunked` or streaming." HTTP/2 end-to-end response size is not documented; the PR says so.

## Migration Plan

No migration, no config. Rollback is a revert.

## Planner Notes

Self-approved: helper placement (D1); `Option[Boolean]` on `CachedRunStatus` (D4); keeping the `runResult` key (D5);
fixture path (D7); `/preview` gaining `rowsTruncated` (same response type; leaving it `false` while it truncates would
be a lie).
