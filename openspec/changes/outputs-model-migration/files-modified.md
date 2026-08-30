# Files modified — cycle 17 (this run)

Scope: task 3.8 (`PipelineProposalService` real Output composition), the
`ProposalPanelSupport`/`DashboardProposalService`/`DashboardContentsService`
Output-binding rewire it required, a genuine `PanelType.Default` bug fix, and
`ApiRoutesSpec`'s full per-kind test cleanup (root cause 1 from cycle 16).
Only files touched THIS cycle are listed — see `execution-progress.md` for the
full ticket history.

## Production code

- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala`
  — task 3.8: `apply` now creates a real `Output` (via `OutputRepository`) on
  the pipeline's last trunk step (root if none) instead of relying solely on
  the legacy minted DataType; `outputDataTypeId` (field name unchanged) now
  carries the real Output id. Rollback (`rollbackAll` and the external
  `rollback`) deletes BOTH the Output and the still-separately-minted legacy
  DataType (task 3.5 hasn't removed that minting yet). Constructor gains an
  `OutputRepository` param.
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala`
  — `buildDataConfig`/`mergeConfig` now emit `outputId` (not
  `dataTypeId`/`fieldMapping`) for an `"output"`-kind panel; `outputId` is
  the real fix for cycle 16's diagnosed root cause 2. `preValidateBindings`/
  `validateDataTypeBinding` gain an `OutputRepository` branch (nullable-
  optional, matching this file's existing convention) so an `"output"`-kind
  panel's binding validates against a real Output, not a DataType.
- `backend/src/main/scala/com/helio/services/proposals/DashboardProposalService.scala`
  — threads a new nullable-optional `outputRepo: OutputRepository` param
  through to `preValidateBindings`.
- `backend/src/main/scala/com/helio/services/dashboards/DashboardContentsService.scala`
  — same `outputRepo` threading for its own `preValidateBindings` call.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires
  `outputRepoOpt.orNull` into `DashboardProposalService`,
  `DashboardContentsService`, and `PipelineProposalService`'s constructors.
- `backend/src/main/scala/com/helio/domain/model/model.scala` — **real bug
  fix**: `PanelType.Default` was `Output` (from the prior cycle's 5-value
  collapse commit) — since `OutputPanelConfig` requires a non-empty
  `outputId`, this made an ordinary `POST /api/panels` with no `type` 400
  instead of creating a plain panel. Changed to `Divider` (content-only,
  always config-valid empty). This single fix cleared 31 of `ApiRoutesSpec`'s
  67 failures.

## Tests — rewired to the real Output-binding shape (kept, not deleted)

- `backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorSpec.scala`,
  `AssistantServiceSpec.scala` — `newExecutor`/`newAuthoringService`
  construction sites updated for the new constructor params; two
  `"output"`-kind binding tests retargeted to mock `OutputRepository`
  instead of `DataTypeRepository`.
- `backend/src/test/scala/com/helio/services/proposals/DashboardProposalServiceValidateSpec.scala`,
  `DashboardAuthoringServiceSpec.scala` — same retargeting; the latter's
  `insertPipelineOutputType` helper now additively seeds a real pipeline +
  Output (id reused from the DataType's own id string — `outputs.id` has no
  FK to `data_types`) so every existing call site keeps working unmodified.
- `backend/src/test/scala/com/helio/services/proposals/CombinedProposalServiceValidateSpec.scala`,
  `backend/src/test/scala/com/helio/services/pipelines/PipelineProposalServiceValidateSpec.scala`,
  `PipelineProposalServiceRestConfigSpec.scala` — constructor call-site
  arity fix only (new `outputRepo` param, `null`).
- `backend/src/test/scala/com/helio/api/routes/proposals/ApplyProposalSpecBase.scala`,
  `CombinedApplyProposalSpecBase.scala` — seed a real pipeline + Output
  (`pipelineOutputId`), pass `dbContext = ctx` to `ApiRoutes` so a real
  `OutputRepository` is wired.
- `backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala`,
  `DashboardApplyProposalConfigSpec.scala`, `DashboardApplyProposalBindingSpec.scala`,
  `DashboardContentsReplaceSpec.scala`, `CombinedApplyProposalSpec.scala`,
  `backend/src/test/scala/com/helio/api/routes/panels/PanelBatchCreateSpec.scala` —
  retargeted `dataTypeId`/`fieldMapping` fixtures to `outputId`/
  `pipelineOutputId` for `"output"`-kind panels; updated binding-rejection
  message assertions (`"pipeline-output"` → `"not found"`, since there's no
  "companion" concept for Outputs).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalRollbackSpec.scala`,
  `PipelineApplyProposalSpec.scala` — capture `resp.pipeline.outputDataTypeId`
  (the still-separate legacy DataType id) alongside `resp.outputDataTypeId`
  (now the real Output id) for the row-population `GET /api/types/:id/rows`
  checks; dropped the now-Output-shaped `GET /api/types/:id` read-back
  assertion (no `GET /api/outputs/:id` route yet).

## Tests — deleted (retired functionality, no Output-shaped equivalent)

- `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala`
  — "write dashboard.create but NOT dashboard.delete when panel creation
  fails partway through": its trigger (a metric flipped to a companion
  DataType post-creation) has no surviving code path (`validateMetricBinding`
  is deleted; there's no Output equivalent asymmetry).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — the full
  per-kind cleanup (cycle 16's deferred root cause 1): every test exercising
  retired `collection`/`timeline`/`chart`/`table`/`metric` PanelType
  behavior (HEL-310, HEL-317 create+timeline-sort-reject, HEL-292 aggregation
  persistence, HEL-255 table density/columnOrder, HEL-248 chart chartOptions,
  HEL-293 metric literal label/unit, HEL-305 chartType validation on
  create/PATCH/updateBatch, HEL-296 batchUpdate aggregation/label persistence,
  two chart-entry import tests). Tests exercising a still-live, kind-agnostic
  feature (panel appearance's `chart` sub-object, generic `dataTypeId`
  binding via `type_id`) were kept and retargeted to a valid panel type
  (`"divider"`/`"text"`) instead of deleted.
