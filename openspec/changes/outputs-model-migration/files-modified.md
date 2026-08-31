# Files modified — cycle 23 (this cycle)

Section 3 finish: 3.2's remainder (WorkspaceSearchService Metric branch, WorkspaceTeardownRepository
data_type branch, DashboardContentsService dead metricRepo param), 3.3 (PatchSetApplyService +
patch-set file family: dataType removed outright as a target.kind), 3.15 (ApiRoutes.scala
"data-type" ResourceType registration removal).

## Main sources

- `backend/src/main/scala/com/helio/services/workspace/WorkspaceSearchService.scala` — Metric
  branch (constructor param, find/getResource cases, toMetricSummary/toMetricDetail) removed
  outright, not retargeted.
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceAssistantTools.scala` — `"metric"`
  dropped from the `find`/`get_resource` `ResourceTypeEnum` and tool descriptions.
- `backend/src/main/scala/com/helio/domain/model/WorkspaceResourceType.scala` — `Metric` case
  object removed (asString/fromString).
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceResourceSearchProtocol.scala`
  — `WorkspaceResourceMetric`/`WorkspaceResourceDetail.MetricDetail` wire shapes removed;
  `MetricProtocol` mixin dropped.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `assistantServiceOpt` no longer gated on
  `metricServiceOpt` (WorkspaceSearchService no longer needs a `metricService` arg);
  `patchSetApplyService`/`patchSetUndoService` constructor calls drop `dataTypeService`;
  `"data-type"` `ResourceType` registration removed (task 3.15).
- `backend/src/main/scala/com/helio/infrastructure/persistence/workspace/WorkspaceTeardownRepository.scala`
  — `resourceKind = "data_type"` branch (and its 3 guards: output-DataType-dependent-pipeline,
  source-link, panel-bound) removed outright; `dataTypeRepo` dropped from the constructor;
  `typesDeleted` removed from `TeardownOutcome`.
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceTeardownService.scala` —
  `typesDeleted` removed from the audit-metadata object and `TeardownResponse` mapping.
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceProtocol.scala` —
  `TeardownResponse.typesDeleted` removed (jsonFormat8 → jsonFormat7).
- `schemas/workspace/workspace-teardown-response.schema.json` — `typesDeleted` property/required
  entry removed; `TeardownConflict.resourceKind` enum narrowed to `["data_source"]`.
- `backend/src/main/scala/com/helio/services/dashboards/DashboardContentsService.scala` — dead
  `metricRepo: MetricRepository` constructor param removed (unused since task 3.9); `dataTypeRepo`
  kept (still backs non-`"output"`-kind panel-binding validation).
- `backend/src/main/scala/com/helio/api/protocols/patchsets/PatchSetProtocol.scala` — `"dataType"`
  removed from `recognizedKinds`; `Edit.dataTypePatch`/`UpdateDataTypeRequest` removed from the
  wire case class and its reader/writer.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` —
  `resolveDataTypeUpdate`/`resolveDataTypeDelete` and their `("dataType", ...)` dispatch cases
  removed (falls through to the existing generic "unsupported target.kind" rejection).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyTypes.scala` —
  `ResolvedAction.DataTypeUpdate`/`DataTypeDelete` and `PatchSetApplyServices.dataTypeService`
  removed; `PatchSetApplyContext.dataTypeRepo`/`dataTypeService` (on `PatchSetApplyService` itself)
  KEPT (still used by panel-binding validation, unrelated to target.kind).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyForward.scala` /
  `PatchSetApplyRollback.scala` — `dataType` ResolvedAction cases removed;
  `fullDataTypeInverse` removed from Rollback.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyService.scala` —
  `dataTypeService` constructor param removed.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyServiceJson.scala` —
  `DataTypeProtocol` mixin removed (unused after the above).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjection.scala` /
  `PatchSetPreviewImpact.scala` — `dataType`-update/-delete content checks and the
  `DataTypeDelete` unbind-hint case removed.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoTypes.scala` /
  `PatchSetUndoConflictCheck.scala` / `PatchSetUndoService.scala` / `PatchSetUndoInverse.scala` —
  `dataType` undo-restore/conflict-check paths, `PatchSetUndoContext.dataTypeRepo`,
  `PatchSetUndoService`'s `dataTypeService`/`dataTypeRepo` constructor params, and
  `fullDataTypeInverse` all removed.
- `backend/src/main/scala/com/helio/services/patchsets/RefinementEditShape.scala` — Claude-facing
  prompt text no longer documents `"dataType"` as a valid target.kind/update-patch example.

## Tests

- `backend/src/test/scala/com/helio/services/workspace/WorkspaceSearchServiceSpec.scala` — metric
  fixtures/tests removed; constructor call updated.
- `backend/src/test/scala/com/helio/api/routes/assistant/AssistantConversationRoutesSpec.scala`,
  `backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorSpec.scala`,
  `backend/src/test/scala/com/helio/services/assistant/AssistantServiceSpec.scala` —
  `WorkspaceSearchService` constructor calls drop the `metricService` arg.
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceTeardownServiceSpec.scala` —
  sections 6.5/6.6/6.12 (data_type-guard scenarios) removed; 6.3/6.4/6.6a/6.7/6.8/6.9 updated to
  drop `typesDeleted` assertions and companion-DataType-deletion expectations (a companion now
  survives its source's deletion, orphaned but present); dead `panelRepo`/`dashboardRepo`/
  `TextPanel` fixtures removed.
- `backend/src/test/scala/com/helio/api/routes/ResourceTaggingSpec.scala` — `WorkspaceTeardownRepository`
  constructor call drops `dataTypeRepo`.
- `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala` — `typesDeleted`
  assertions removed from the two teardown-audit tests.
- `backend/src/test/scala/com/helio/api/protocols/patchsets/PatchSetProtocolSpec.scala` —
  `dataTypePatch` field/assertions removed; 2 new tests assert `"dataType"`/`"metric"` are rejected
  as target kinds.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — mechanical
  `Edit(...)` 9→8-arg fix throughout; tests 7.7/7.10c rewritten onto a `dataSource`-delete scenario
  (same "unrecoverable, not silently hidden" intent, `dataType` no longer usable for it);
  `dataTypeService`/`dataTypeRowRepo` fixtures removed (dead after the constructor change).
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewServiceSpec.scala` — 6
  dataType-content-check/hint test scenarios (6.4d/e/f/g, 6.5h/i/j) removed outright (the checks
  they exercised no longer exist); `dataTypeResponseNormalized` helper and now-unused imports
  removed.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` — 5.3a's
  edit set drops its `dataType` update edit (5 restored edits, not 6); constructor calls updated.
- `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetPreviewRoutesSpec.scala`,
  `PatchSetRoutesSpec.scala`, `PatchSetUndoRoutesSpec.scala`,
  `backend/src/test/scala/com/helio/services/patchsets/RefinementServiceSpec.scala` — mechanical
  `Edit(...)` fix + constructor-arg drops + `"data-type"` `AclResourceType` registration removed.

## OpenSpec / schema

- `openspec/changes/outputs-model-migration/tasks.md` — 3.2/3.3/3.15 marked `[x]` with detailed
  completion notes; section 3 is now 15/15 `[x]`.
