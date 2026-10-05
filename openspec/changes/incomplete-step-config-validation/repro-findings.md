# HEL-1147 premise verification: findings

Worktree: /home/matt/Development/helio/.claude/worktrees/bug/preview-incomplete-step-config/HEL-1147 (HEAD 63a0b3ea). Backend on 9486, PID 1582259, cwd confirmed as this worktree's backend/. Backend log: `<worktree>/.concertino-backend.log`. Every probe was a live HTTP call against the real dev DB.

## Task 1: literal repro. CONFIRMED, with a correction
- Route: **GET /api/pipelines/:id/steps/:stepId/preview** (PipelineRunStatusRoutes.scala:38). The ticket did not name the route.
- Step create `POST /api/pipelines/:id/steps` with `{"type":"upsertsource","config":{"target":{"kind":"newSource","name":""},"mode":"append"}}` returns **201**. The empty name is accepted by design ("legitimate to save").
- Preview returns **422** with `{"message":"Pipeline execution failed at step <stepId> (upsertsource) [path: root:<rootId> > <stepId>]: 'upsertsource' step requires a non-empty 'target.name' for a new source"}`.
- Log: `ERROR c.h.s.pipelines.PipelineRunService - previewStep failed for pipeline <pid>, step <sid>`, followed by a full `StepExecutionException` stack trace and `Caused by: java.lang.IllegalArgumentException: ...`. That is about 22 `at` frames per event.
- Chain:
  - InProcessPipelineEngine.scala:264-266: `requiredConfigProblems` fires `Future.failed(new IllegalArgumentException)`.
  - :275 → `StepExecutionException.from` (:50): wraps the exception.
  - PipelineRunService.scala:618-628 (`previewStep .recover`): `log.error(..., ex)` then `UnprocessableEntity`.
- Correction to the ticket: the client gets a clean 422 with a readable message. The defect is the server-side ERROR-plus-stack logging, and the fact that preview runs at all for a step that analyze already knows is incomplete. Nothing crashes, and the response is not a 500.

## Task 2: widening the upsert config (create → preview)
| config | create | preview |
|---|---|---|
| name `""` | 201 | 422, ERROR + stack |
| name `"   "` (whitespace only) | 201 | 422, ERROR + stack, same message |
| name absent `{"kind":"newSource"}` | **422** "Invalid 'upsertsource' config: 'target' with kind 'newSource' requires a string 'name'." | n/a |
| name null | 422, same message | n/a |
| target absent `{"mode":"append"}` / target null / config `{}` | 201 (stored as `existingSource ""`) | 422 "...requires a 'target' (an existing data source or a new source name)", ERROR + stack |
| existingSource id `""` | 201 | 422, same as above, ERROR + stack |
| existingSource with dataSourceId absent | 422 "...requires a string 'dataSourceId'." | n/a |
| existingSource nonexistent UUID / garbage id | **404** "Data source not found: <id>" | n/a |
| existingSource = the pipeline's own root source | **400** cycle "src -> pipe -> src" | n/a |
| existingSource = another, non-dataset CSV source | **201** | **200** (preview does not write) |
| mode missing (valid name) | 201 (defaults to append) | 200 |
| mode "upsert" | 422 "'mode' must be one of append, replace, got 'upsert'." | n/a |
| mode 5 | 422 "'mode' must be a string, got a number." | n/a |
| target.kind "bogus" | 422 "'target.kind' must be ...got 'bogus'." | n/a |

- Deleted-source target: I could not create one through the API. `DELETE /api/data-sources/:id` on a source that is an upsert target is refused with "still referenced by pipeline(s) ... as upsert target" (HEL-1252 guard), so the case does not arise.
- **Separate gap (not HEL-1147's class):** an existingSource target pointing at a non-dataset source gets through four checks with no error:
  - create returns 201
  - analyze reports no `validationError`
  - preview returns 200
  - dry run returns 200

  It fails only on a **real** run: 422 "Step (upsertsource): Data source is not a dataset: <id>", logged ERROR "Pipeline write-back failed ..." with no stack trace.

## Task 3: surfaces, for the incomplete `newSource ""` step
- **Analyze** `GET /api/pipelines/:id/analyze`: 200. The step carries `"validationError":"'upsertsource' step requires a non-empty 'target.name' for a new source"`. No log. Note that `costVerdict.canRun` is still **true** (only `writeback-step` and `row-estimate-unavailable` reasons), so canRun ignores validationError.
- **Output create** (on the incomplete step): 201. No log, so no backfill error was observed.
- **Output preview** `POST /api/pipelines/:id/preview` and `?outputId=`: both 422 with the identical message. The log line is still `previewStep failed` (it routes through previewStep), ERROR + stack.
- **Dry run** `POST /api/pipelines/:id/run?dry=true`: synchronous 422, same message. Log: ERROR "Pipeline execution failed for pipeline X, run Y" + stack (PipelineRunService.scala:1095 `executeRunFailure`). No run row persisted.
- **Real run** `POST /api/pipelines/:id/run`: 422, same message, ERROR + stack. It persists a `failed` pipeline_runs row whose errorLog is the step message (visible in `/run-history` and `/runs/latest`). `GET /runs/:runId` returned 404 "Run not found" (cache only).
- **Pipeline proposal analyze** `POST /api/pipelines/analyze-proposal` (needs `clientId` per step, otherwise 400): 200 with step `validationError` set. No log.
- **Pipeline proposal apply** `POST /api/pipelines/apply-proposal`: creates the pipeline, then runs a **real** `submit(isDry=false)` (PipelineProposalService.scala:525). That run fails with 422 and the same message, ERROR + stack, and the pipeline is rolled back (GET returns 404 afterwards). So apply does not pre-check validationError; it learns about it by running.
- **Combined** `POST /api/proposals/apply`: requires `dashboard`, so it returned 400 before reaching the pipeline (not exercised further). Per code reading, CombinedProposalService.scala:97 delegates to `pipelineProposalService.apply`, so it would take the same path.
- **MCP:**
  - `add_pipeline_step` maps to `POST /api/pipelines/:id/steps` (helioApi.ts ~:765; handler assertSchemas.ts:138 has client-side checks for `assert`/attachAsTail only), so it behaves the same as the create row above: 201.
  - `analyze_pipeline_proposal` maps to `POST /api/pipelines/analyze-proposal` (helioApi.ts:349).
  - `apply_pipeline_proposal` maps to `POST /api/pipelines/apply-proposal` (helioApi.ts:1045).
  - The MCP server was not run.
- **Patch-sets:** `pipelineStep` create goes through `pipelineService.addStep` (PatchSetApplyRollback.scala:207), so it should accept like the create row. Not exercised live.

## Task 4: class check. The defect is CLASS-WIDE
Every one of these was created with 201 and then previewed, giving 422 + ERROR + full stack (22-26 frames), through the identical `previewStep failed` path:
- compute `{"column":"","expression":"1"}` gives "compute step is missing required config value 'column'."; compute `{}` gives both column and expression, joined with "; ".
- join `{}` gives "join step is missing required config value 'joinKey'."
- datebucket `{}` gives "...missing required config value 'field'."
- dedupe `{"keep":"middle"}` gives "Unsupported dedupe keep: 'middle'. Supported: first, last".
- filter `{"combinator":"XOR"}` gives "Unsupported filter combinator: 'XOR'. Supported: AND, OR".
- window `{"function":"row_number"}` gives "...missing required config value 'outputColumn'."
- stringops split without outputColumn gives "...missing required config value 'outputColumn'."

generatetext `{}` was rejected at **create** with 422 (its validateRawConfig is strict), so it never reached preview.

**Evaluate-time IAE NOT covered by `requiredConfigProblems`** (the exception comes from `step.evaluate`; the analyze side catches some of these via per-kind validators in PipelineAnalyzeService.scala:374-384):
- FillNullStep.scala:85 and :92. Repro: fillnull `{"strategy":"constant","columns":["name"]}` → create 201 → preview 422 "fillnull strategy 'constant' requires 'value'", ERROR + stack (26 frames).
- WindowStep.scala:100, :107, :115, :143. Repro: window `{"function":"lag","outputColumn":"o"}` → 201 → 422 "window function 'lag' requires 'field'", ERROR + stack.
- PivotStep.scala:81. Repro: pivot agg "bogus" → 201 → 422 "Unsupported pivot aggregation function: 'bogus'...", ERROR + stack.
- Not reproduced: StringOpsStep.scala:100/110/113/118/162/165, AggregateStep.scala:96/119 (create rejected my config shape), GroupByStep.scala:74 (not authorable), UnionStep.scala:70, JoinStep.scala:71, ChunkByTokenCountStep.scala:107, and the AI-step `fail()` helpers (GenerateTextStep:51, AnalyzeWithAiStep:51, ConvertFormatStep:52).

All of these end in the same `StepExecutionException` → `log.error(..., ex)`. So a fix keyed only on `requiredConfigProblems` would leave fillnull, window and pivot still logging stacks.

## Task 5: frontend
- Step preview hook: `frontend/src/features/pipelines/hooks/useStepCardPreview.ts:101-115` calls `fetchStepPreview` (services/pipelineService.ts:285-293). On error it does `setPreviewError(extractErrorMessage(err, "Preview failed — try again."))`.
- The error renders **inline in the step card's preview tray**: StepCard.tsx:439-442 `<p className="pipeline-detail-page__step-preview-error" role="alert">`. That is the backend message verbatim, including the step UUID and the `[path: root:<uuid> > <uuid>]` text. There is no toast and the error is not swallowed.
- There is no gating: the fetch runs whenever `expanded && previewOpen` and the step is enabled. Only disabled steps are skipped. The analyze `validationError` is not consulted.
- An analyze-driven indicator already exists:
  - `usePipelineDetailPage.ts:509-518,586` builds `getAnalyzeValidationError(stepId)`.
  - It is passed as `validationError` into StepCard (from LaneColumn.tsx:213,263 and PipelineRiverView.tsx:370).
  - StepCard.tsx:251-259 renders a header TriangleAlert chip ("Step has a validation error") and an `--errored` class.
  - StepCard.tsx:380 renders an `<InlineError>` in the body (compute renders its own via ComputeFieldConfig).

  So an expanded incomplete step with the preview open shows the same problem **twice**: once as the body InlineError (clean text), once in the preview tray (the step-id/path-prefixed version).
- Output preview: `outputService.previewStep` (outputService.ts:250) and outputsSlice.ts:218-227 `rejectWithValue(extractErrorMessage(err, "Failed to preview step."))`.

## Task 6: existing tests that pin current behaviour
- InProcessPipelineEngineSpec.scala:2606 pins the exact format `"Pipeline execution failed at step step-id (stringops): ${reason}"`.
- PipelineRunRoutesSpec.scala:736, :851, :1053: `startWith("Pipeline execution failed at step <id> (join)")` on run errorLog and the 422 body.
- PipelineRunRoutesSpec.scala:676-686: step preview returns 422 when the step is **disabled**. That is the only preview-422 route test; **no route test covers preview 422 for incomplete config**.
- PipelineStepRequiredConfigSpec.scala:42-45 `runFailure` intercepts `StepExecutionException` from `engine.execute`. Tests at :283, :336, :401 and others assert that the RUN fails with stepKind and reason. Exact wording is pinned at :125-129 ("compute step is missing required config value 'expression'.").
- InProcessPipelineEngineTreeWalkSpec.scala:91-100: the requiredConfigProblems throw leads to a `StepExecutionException`, with parity across both engines.
- UpsertSourceStepSpec.scala:43, :49, :55: `requiredConfigProblems` non-empty for an empty target or blank name, empty for valid.
- PipelineRunServiceUpsertSourceSpec.scala:223-233: previewStep on a valid upsert is Right and the target is unchanged.
- Frontend: StepCard.test.tsx:165-172 pins the generic fallback "Preview failed — try again."; the test right after (~:174) covers the parsed backend message. PipelineDetailPage.test.tsx:3195 pins the same fallback.
- Log level: **no test asserts the log level** for the preview or run failure paths. JsonLogCapture and the ListAppender in ApiRoutesCorsErrorHandlingSpec.scala:224 exist as reusable capture patterns.
- No test in helio-mcp/src or e2e/ asserts preview 422 or these messages (e2e has preview specs hel908/hel912/hel968, but none on this case).

## Could not verify
- Combined-proposal apply (blocked by the required `dashboard` field) and patch-set apply were not exercised live; both are from code reading.
- Scheduled and auto-run (HEL-1093 debounce) triggers on an incomplete step were not exercised.
- The MCP server itself was not run (endpoint mapping is from code).
- A deleted-source upsert target cannot be produced, because deletion is blocked.

## Residue (all created by this probe, all deleted by exact id)
| kind | id | deleted |
|---|---|---|
| data source (csv) hel1147-probe-src | 7cdd9bbb-8515-415b-a7f2-874367f2ba8c | yes (204) |
| data source (csv) hel1147-probe-src2 | 0e904b76-9723-4c0d-90a9-a2c4a6d35cd8 | yes (204) |
| pipeline hel1147-probe-pipe | e4146880-aa62-4f3d-93f8-d23bf339862b | yes (204), GET 404 |
| pipeline hel1147-probe-pipe2 | f49d9fc2-a638-46a8-b388-f4d84ff5a6b1 | yes (204), GET 404 |
| output hel1147-out | 038456da-3d23-4718-87b8-5b2ce733f711 | yes (200), GET 404 |
| step upsert newSource "" (pipe1) | 55939c84-767e-4ec4-a3bd-bf3635e8f984 | yes (200) |
| step upsert existing non-dataset (pipe2) | 4d5768b2-99fa-4e24-9444-1ccfec7db37f | yes (200) |
| 19 further probe steps on pipe2 (ids in scratchpad h1147/ids.txt) | e.g. 014b89da..., a7e12560..., 8d144f0b..., 23b2d303..., 71cbe7ce... | each deleted right after its probe (200) |
| failed run row (pipe1) | a6385501-59bc-45c6-8b7f-99c2092db555 | removed with pipeline delete (cascade, not separately verified) |
| dry run row (pipe2, success) | 7e07faea-0728-443f-a691-4fc1d560c0bd | removed with pipeline delete (cascade, not separately verified) |
| failed run row (pipe2, write-back) | d0c171b9-887f-41be-9374-d0a3c294c60a | removed with pipeline delete (cascade, not separately verified) |
| apply-proposal pipeline (auto-rolled-back) | fdf5aec2-f8c3-44b7-8c4a-835fec15521e (run 23f4af4f-79da-4b36-91a0-50c3bc4ed8ea) | rolled back by the server, GET 404 |

- No dataset named "hel1147-should-not-be-created" was created (that step was only previewed). A data-source listing filtered on "hel1147" is empty afterwards.
- Processes: backend PIDs 1582259 (java), 1580445 (sbt launcher) and 1580348 (sbt script) were killed by exact PID, and port 9486 is free.
- The **frontend vite PID 1582582 (port 6579, cwd = this worktree's frontend/) is still running**. It was not in my stop instruction; kill it by that PID if it is not wanted.
