- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — new shared `rawConfigProblem(kind, raw)` helper (D2)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — 3 sites routed through helper
- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala` — 1 site routed through helper
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` — 2 sites via helper; `resolvePipelineStepCreate` now 422 `edit N: <msg>` at resolve (D1)
- `backend/src/main/scala/com/helio/domain/engine/ColumnSchemaInference.scala` — `inferCompute`: `type` optional (absent or null), `string` fallback (D3); minimal edit
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetStepCreateConfigRoutesSpec.scala` — new, real apply+preview routes
- `backend/src/test/scala/com/helio/domain/engine/ComputeOptionalTypeAnalyzeSpec.scala` — new, compute-without-type
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineCreateStepConfigRoutesSpec.scala` — aggregate case asserts `Step 'agg':` + `bogus`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — two HEL-1310/1416 step-create cases moved from "200 + failure" to the new 422 `edit 0:` (they asserted the exact old behaviour this ticket replaces; update-edit assertions untouched)
- `openspec/specs/pipeline-step-config-rejection/spec.md` — Purpose widened; HEL-1416 surface list adds patch-set step-create

## Proof (commands run with `nice -n 19 sbt -J-Xmx3g`)
- RED (whole pre-fix main tree, only the new test added) `testOnly ...PatchSetStepCreateConfigRoutesSpec`:
  `apply: 200 OK was not equal to 422`, `preview: 200 OK was not equal to 422` -> Tests: succeeded 1, failed 2.
- GREEN same spec + ComputeOptionalTypeAnalyzeSpec + PipelineCreateStepConfigRoutesSpec: Tests: succeeded 18, failed 0.
- RED compute (ColumnSchemaInference reverted to pre-fix): 3 of 6 failed (valid expr, null type, unknown field); with-type and missing-column cases pass both ways (unchanged behaviour guard).
- MUTATION 3.2 (`rawConfigProblem` -> `None`): 9 failed across new route spec, PipelineCreateStepConfigRoutesSpec, PatchSetPipelineCreateStepConfigSpec; restored.
- MUTATION 3.4 (drop `Step '<id>':` prefix in PipelineService create): the compute and aggregate cases in PipelineCreateStepConfigRoutesSpec fail; restored.
- `testFull`: 6496 passed, 2 failed (PatchSetApplyServiceSpec HEL-1310/1416 step-create cases, expected old shape) -> updated; `testOnly com.helio.services.patchsets.* com.helio.api.routes.patchsets.*`: 157 passed, 0 failed. No other failures in the full run.
- `openspec validate --specs`: 467 passed, 0 failed.

## Task 2.1 caller findings (grep)
- frontend `patchSetsSlice.ts` (preview l.55, apply l.237): any non-2xx is caught and `response.data.message` surfaced via `rejectWithValue` -> the 422 `edit N: ...` message shows in the review page; no change needed.
- helio-mcp `helioApi.ts` throws `HelioApiError` on non-ok responses; no change needed.

## Notes
- `"type": null` on compute: treated as absent (my call).
- PipelineService split: HEL-1463 (not done here).
