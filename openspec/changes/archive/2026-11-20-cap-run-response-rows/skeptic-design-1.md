## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `fef01cda9c089e90c2f93f65e1b59ee1f11d8a16` (planning artifacts untracked in the change dir).
Owner rulings (cap 10, MCP pass-through, GET /runs/:runId capped, `rowsTruncated`) taken as given, not re-litigated.

### What I verified (with evidence)

- `RunResultResponse` is at `api/protocols/pipelines/PipelineProtocol.scala:280` with 11 fields; its format is
  `jsonFormat11` at `:405`. So D1's move to `jsonFormat12` is correct, and a plain `Boolean` is always written.
- There are exactly four construction sites, matching the design: `PipelineRunExecutor.scala:361` (`jsRows, jsRows.size`),
  `PipelineRunService.scala:250` (the empty, blocked never-attempted run, where a `false` default is correct), and
  `PipelineRunPreview.scala:208` and `:296` (`allJsRows.take(10)`, `rowCount = allJsRows.size`, no flag).
- D2 holds. In `executeRunSuccess` the full `jsRows` is passed to `onRunSuccess` (the writes) before the response is
  built at `:361`, so capping only the response value leaves the writes untouched.
- The other `submit` callers (`DraftSaveService:174`, `HookTriggerService:74`, the scheduler at `:250`, the auto-run firer
  at `:122`, `PipelineProposalService:617`) read only `runId` and `blocked`. This matches the design's claim.
- `PipelineRunQueries.runStatus` (`:64-76`) renders every cached row, then builds
  `CachedRunStatus(..., entry.rows.map(_.size))`. This matches the design's description.
- Web: `runResult` has two writers, `submitPipelineRun.fulfilled` (`pipelinesSlice.ts:292`) and `setRunStatus` (`:148`,
  which has no non-test dispatcher). Its only reader is `SpineRunStatus.tsx:33-35` (`runResult.length`), reached through
  `usePipelineOwnPipeline` → `usePipelineDetailPage:215` → `PipelineSpineLayout:169` / `MobilePipelineHeader:172`.
  `fetchRunStatus` has no non-test caller. The stale comment is at `pipelinesState.ts:44`. There are two `RunResult`
  TS types (`pipelineService.ts:238`, `types/output.ts:164`). The chip's text "Snapshot replaced: N rows" and
  "Preview: N rows" is confirmed at `SpineRunStatus.tsx:46-52`.
- `PipelineProposalApplyResponse.run` is typed `Record<string, unknown>` and is never read by the review pages.
- MCP: `runPipeline` (`helioApi.ts:849-870`) already reshapes the result to counts and never reads `rows`.
  `applyPipelineProposalHandler` (`pipelineProposalHandlers.ts:83`) is a pure pass-through. `get_output_rows` exists
  (`tools/outputs.ts:264`). The `RunResultResponse` type is at `types.ts:743`.
- helio-news (`~/Development/helio-news`): its code calls only `run_pipeline` (`news/timeseries.py`,
  `news/helio_client.py`). There is no apply tool and no read of `rows`, which confirms the proposal's non-goal.
- Spec deltas: every MODIFIED header matches its base requirement verbatim, and every base scenario is carried over.
  `pipeline-run-response-preview` is new, with no collision.
- Schemas: no JSON schema describes `RunResultResponse`. `pipeline-preview-response.schema.json` types `preview` as an
  opaque `object`, so `check:schemas` has nothing that would drift.
- D7's fixture pattern exists. `AskSeamSpec` normalises ids and instants, writes the fixture under an env flag and
  compares against it. helio-mcp tests and frontend tests already read `shared-test-fixtures/`.

### Verdict: REFUTE

### Change Requests

1. **D4 / task 1.4 / test 0.3 stop one layer short of the wire, so the GET /runs/:runId cap can pass its test without
   reaching clients.** `CachedRunStatus` is a service-side projection. The route copies it field by field into
   `RunStatusResponse(cached.runId, cached.status, cached.rows, cached.error, cached.rowCount)`
   (`api/routes/pipelines/PipelineRunStatusRoutes.scala:34`). `RunStatusResponse` (`PipelineProtocol.scala:143`) has a
   **hand-written** format (`:375-397`) that emits only `runId`, `status`, `rows`, `error` and `rowCount`.
   If `rowsTruncated` is added to `CachedRunStatus` alone, as task 1.4 says, it compiles. Test 0.3, which is written
   against `PipelineRunQueries.runStatus`, then goes green, but the field never appears in the HTTP body. That breaks the
   `pipeline-run-status-access` delta ("`rowsTruncated` SHALL be `true`").
   Revise the following:
   - (a) D4 and task 1.4 add `rowsTruncated: Option[Boolean]` to `RunStatusResponse`, to both its custom `write` and
     `read`, and to the route translation at `PipelineRunStatusRoutes.scala:34`.
   - (b) Test 0.3 becomes, or gains, a route-level assertion on the real `GET /api/pipelines/:id/runs/:runId` body
     (`PipelineRunRoutesSpec` already exercises this route at `:336`/`:352`): `rows` length 10, `rowCount` 25,
     `rowsTruncated` true. The mutation list in 4.1 gains "drop the field from the RunStatusResponse writer".
   - (c) Decide, and state, whether the frontend `RunStatusResponse` TS type (`types/pipelineStep.ts:740`, which already
     lacks `rowCount`) gains `rowCount` and `rowsTruncated`, or is left alone because `fetchRunStatus` has no caller.
     Either answer is fine, but it must be written down.

2. **The capability spec omits a route the helper changes.** The step-preview path at `PipelineRunPreview.scala:296` also
   serves `GET /api/pipelines/:id/steps/:stepId/preview` (`PipelineRunStatusRoutes.scala:37-40`, consumed by
   `outputService.ts:268` and `pipelineService.ts:320`). D1 makes it gain `rowsTruncated`, but the ADDED requirement in
   `specs/pipeline-run-response-preview/spec.md` lists only `POST /api/pipelines/:id/preview`. Add the step-preview route
   to the requirement's endpoint list, and either add a scenario for it or extend test 0.2 to cover it. Otherwise the
   spec silently under-describes a wire change.

### Non-blocking notes

- D7 says the backend spec "fails if the real body and the fixture differ", but a real `/run` body carries a random
  `runId` and generated step ids in `stepRowCounts`. State the normalisation (as `AskSeamSpec` does) and the regeneration
  env flag, so the executor does not drop to the spec's narrower "rows length / rowCount / rowsTruncated" comparison by
  accident.
- Consider adding a `schemas/pipelines/run-result-response.schema.json` and validating the fixture against it, which is
  the rest of the `AskSeamSpec` pattern. There is no schema today, so this is an improvement and not a gap this ticket
  must close.
- D5: `setRunStatus` (`pipelinesSlice.ts:139-150`) also writes `runResult` from `rows` and has no dispatcher. Leave it
  unchanged, but do not let it become a second count source. It never sets `runRowCount`, which is the correct outcome.
- D6 types `rowsTruncated?: boolean` as optional in MCP even though the server always writes it. This is acceptable for
  a client tolerating older servers, but the doc comment should say why.
- The full `jsRows` vector is still built for a dry run, which persists nothing and now returns only 10 rows. Building
  only the preview there would cut the dry-run peak heap. This is optional and out of the ticket's scope.
