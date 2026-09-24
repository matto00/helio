# Files modified — HEL-1096 run-to-update affordance

## Backend — source

- `backend/src/main/scala/com/helio/services/pipelines/AutoRunTriggerService.scala` — `triggerAutoRun` now returns `Future[Vector[EvaluatedPipeline]]` (new sealed `EvaluatedPipeline` ADT: `Allowed`/`Denied`), threading the writer through to compute `visible`/`canRun` per denied pipeline (design.md D1); `handleDenied` drops an invisible-to-writer denial entirely.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — split the old fire-and-forget `triggerAutoRun` into `triggerAutoRunFireAndForget` (kept, `deleteRow`-only, unchanged contract) and `triggerAutoRunAwaited` (new, used by `appendRows`/`appendFormRow`/`replaceRows`/`patchRow`); `RowWriteResult`/`RowMutationResult` gain `deniedPipelines: Vector[EvaluatedPipeline.Denied]`.
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — new `DeniedPipelineResponse` wire type + `fromDomain`; `RowWriteResponse`/`RowResponse` gain `deniedPipelines`; `DataSourceProtocol` now extends `PipelineAnalyzeProtocol` to reuse its `CostReasonResponse` format (avoids a duplicate/ambiguous implicit).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` — `CostVerdictResponse` gains `canRun: Boolean`; format bumped to `jsonFormat5`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `analyze` computes `canRun` (owner-or-editor-grantee, mirroring `PipelineRunService.submit`) and passes it into `toCostVerdictResponse`.

## Backend — tests

- `backend/src/test/scala/com/helio/services/pipelines/AutoRunTriggerServiceSpec.scala` — updated existing calls for the new `user` param; added a new "response-facing visibility/canRun gates" describe block (owner/editor/viewer/no-grant/allowed).
- `backend/src/test/scala/com/helio/services/pipelines/DatasetWriteAutoRunCoalescingSpec.scala`, `DatasetWriteAutoRunEndToEndSpec.scala` — updated existing `triggerAutoRun` calls for the new `user` param (no behavior change).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — added `canRun` to two `CostVerdictResponse` fixtures.
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceDeniedPipelinesSpec.scala` (new) — task 3.2: denial folding for all four in-scope call sites + `deleteRow`'s unchanged 204 contract.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineServiceCanRunSpec.scala` (new) — task 3.3: `costVerdict.canRun` for owner/editor/viewer.
- `backend/src/test/scala/com/helio/api/protocols/sources/RowWriteResponseDenyReasonCoverageSpec.scala` (new) — task 3.1: every `CostReason.code` survives end-to-end into `RowWriteResponse`.
- `backend/src/test/scala/com/helio/services/sources/DatasetWriteSubmitLatencySpec.scala` (new) — task 3.4/C12: measured p50/p95 submit-latency before/after (see PR body / handoff for numbers).

## Frontend — source

- `frontend/src/features/pipelines/services/denyReasonCopy.ts` (new) — task 2.1: the deny-copy mapping.
- `frontend/src/features/pipelines/services/deniedPipelinesToast.ts` (new) — task 2.3: builds the one-toast-per-write payload.
- `frontend/src/features/pipelines/services/runToUpdate.ts` (new) — task 2.4: the shared submit-and-branch-on-429 service call.
- `frontend/src/features/pipelines/hooks/useRunToUpdate.ts` (new) — task 2.4/2.7: React-wired click handler (dismiss + submit + report).
- `frontend/src/features/pipelines/types/pipelineStep.ts` — `CostVerdict` gains `canRun`.
- `frontend/src/features/sources/types/dataSource.ts` — new `DeniedPipelineResponse` type; `RowWriteResponse`/`RowResponse` gain `deniedPipelines`.
- `frontend/src/features/panels/ui/form/FormPanelView.tsx` — pushes the denial toast from both submit paths (`handleSubmit`, `handleImmediateStep`).
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — returns `costVerdict`/`handleRunToUpdate`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — threads `costVerdict`/`handleRunToUpdate` to the footer.
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx` — task 2.5: the denial block.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — task 2.6: denial-block styling (`--app-warning` tokens, mirrors the existing truncation banner).

## Frontend — tests

- `frontend/src/features/pipelines/services/denyReasonCopy.test.ts` (new) — task 3.5, coverage + "Show the red" (manually demonstrated, see handoff).
- `frontend/src/features/pipelines/services/deniedPipelinesToast.test.ts` (new) — task 3.6.
- `frontend/src/features/pipelines/services/deniedPipelineToastA11y.test.tsx` (new) — task 3.7.
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.denial.test.tsx` (new) — task 3.8.
- `frontend/src/features/panels/ui/form/FormPanelView.test.tsx` — switched to `renderWithStore` (now Redux-dependent via `useToast`); added `deniedPipelines: []` to every `RowWriteResponse` fixture.
- `frontend/src/features/panels/ui/PanelContent.test.tsx` — switched to `renderWithStore` for the same reason as `FormPanelView.test.tsx` above (renders a `form`-kind panel, which now depends on Redux via `useToast`) — purely a render-helper swap, no assertion changes.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx`, `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` — added `canRun: true` to `CostVerdict` fixtures.
- `frontend/src/features/sources/ui/DatasetRowGrid.test.tsx`, `frontend/src/features/sources/ui/DatasetRowGridFocusAndConflict.test.tsx`, `frontend/src/features/sources/ui/DatasetRowGridKeyboardMatrix.test.tsx`, `frontend/src/features/sources/ui/DatasetRowGridPagerAndFocusPaths.test.tsx` — added `deniedPipelines: []` to every `RowWriteResponse`/`RowMutationResult` mock fixture (a required field on both types now), plus one incidental type annotation and one reflowed `resolveAppend` call site touched by the same edit — no assertion or behavior changes. (Previously mis-declared as a glob, `DatasetRowGrid*.test.tsx (4 files)`, which this repo's declaration parser does not expand — corrected here to the four explicit paths per orchestrator/driver review at Delivery.)
- `frontend/src/test/rawElementGuardHel440.test.tsx` — added `costVerdict`/`handleRunToUpdate` to the `PipelineDetailFooter` noop-props fixture.

## e2e

- `e2e/hel1096-run-to-update-affordance.spec.ts` (new) — task 3.9: real backend, denial toast + "Run to update" → real run → panel refresh via existing SSE fan-out; 429 guard-rejection distinct message.

## Schemas

- `schemas/sources/denied-pipeline-response.schema.json` (new).
- `schemas/sources/row-write-response.schema.json`, `schemas/sources/row-response.schema.json` — `deniedPipelines` field.
- `schemas/pipelines/pipeline-analyze-response.schema.json` — `CostVerdict.canRun`.

## OpenSpec

- `openspec/changes/run-to-update-affordance/` — the planning artifacts this change implements (proposal/design/tasks/specs), plus this file and `workflow-state.md`.
