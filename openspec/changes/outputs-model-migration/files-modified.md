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

## Cycle 24 (section 4.1, partial — Panel binding-resolution removal)

- `backend/src/main/scala/com/helio/domain/model/Panel.scala` — `dataTypeId`/`buildQuery`/
  `withBindingCleared`/`fieldMapping` removed from the `Panel` trait; `selectedFieldsFromMapping`
  helper removed.
- `backend/src/main/scala/com/helio/domain/panels/TextPanel.scala`,
  `MarkdownPanel.scala` — rewritten: `dataTypeId`/`fieldMapping` removed from
  `TextPanelConfig`/`MarkdownPanelConfig` (now `content`-only, mirrors Image/Divider); `buildQuery`/
  `withBindingCleared` overrides removed.
- `backend/src/main/scala/com/helio/domain/panels/ImagePanel.scala`, `DividerPanel.scala`,
  `OutputPanel.scala` — now-removed trait members' overrides deleted.
- `backend/src/main/scala/com/helio/domain/panels/package.scala` — `dataTypeIdFormat`/
  `metricIdFormat` removed (unused after the above).
- `backend/src/main/scala/com/helio/domain/model/model.scala` — `PanelQuery` case class removed.
- `backend/src/main/scala/com/helio/api/protocols/panels/PanelProtocol.scala` — `panelQueryFormat`
  removed; stale `dataAsOf` doc comments corrected.
- `backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala` — `GET
  /api/panels/:id/query` route removed outright.
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — `dataTypeRepo`/
  `metricRepo` constructor params removed; `resolveBindingsForRead`/`resolveOne`/`resolveBinding`/
  `resolveSingleBinding`/`rejectCompanionBinding` removed outright.
- `backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala` —
  `dataTypeIdFromCreateConfig`/`dataTypeIdFromConfigPatch` removed (both read a `dataTypeId` field
  no create-side config carries anymore).
- `backend/src/main/scala/com/helio/services/panels/PanelPatchApplier.scala` — `resolveBinding`
  callback param removed from `apply` (was always identity after the above).
- `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala` — the
  `dataTypeId`-keyed binding-resolution + `dataAsOf` lookup removed outright; `panelService`/
  `pipelineRepo` constructor params dropped.
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala` —
  `TextPanel`/`MarkdownPanel` row mapping simplified to `content`-only; dead `jsObjectColumn`/
  `parseJsObject` helpers removed.
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala` —
  `existsBoundToType` removed outright (zero remaining callers).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
  — `findLastRunAtByOutputDataTypeId` removed outright (its only caller was
  `PublicDashboardRoutes`'s now-removed `dataAsOf` lookup).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` —
  `validatePanelBindingRefs`/`rejectCompanionBinding` removed; both panel-update/create resolver
  call sites simplified.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewImpact.scala` — the
  panel-update "rebind to a different DataType" impact hint removed.
- `backend/src/main/scala/com/helio/services/patchsets/RefinementPrompt.scala` — the
  `dataTypeId=` suffix removed from the per-panel prompt line.
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` —
  `nonFlatConfigDataTypeId`'s config-only binding-candidate fallback removed (Text/Markdown no
  longer have a real config binding to detect).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `PanelService`/`PublicDashboardRoutes`
  construction calls updated to the new, shorter constructor signatures.

### Tests

- `backend/src/test/scala/com/helio/domain/model/PanelSpec.scala` — rewritten: the retired
  `dataTypeId`/`buildQuery`/`withBindingCleared` sections removed; `TextPanelConfig`/
  `MarkdownPanelConfig` decode/Patch/applyPatch coverage rewritten for the `content`-only shape.
- `backend/src/test/scala/com/helio/infrastructure/persistence/panels/PanelRowMapperSpec.scala` —
  bound/unbound Text/Markdown round-trip scenarios collapsed into two plain content round-trips.
- `backend/src/test/scala/com/helio/services/panels/PanelServiceResolveBindingsSpec.scala`,
  `PanelServiceCompanionBindingGuardSpec.scala` — deleted outright (entirely retired-feature
  coverage).
- `backend/src/test/scala/com/helio/services/panels/PanelServiceBatchUpdateErrorSpec.scala`,
  `PanelServiceBuildAllForCreateSpec.scala` — `PanelService`/mock constructor calls updated.
- `backend/src/test/scala/com/helio/api/routes/patchsets/RefinementRoutesSpec.scala`,
  `PatchSetRoutesSpec.scala`, `PatchSetPreviewRoutesSpec.scala`, `PatchSetUndoRoutesSpec.scala`,
  `backend/src/test/scala/com/helio/services/patchsets/RefinementServiceSpec.scala`,
  `PatchSetApplyServiceSpec.scala`, `PatchSetUndoServiceSpec.scala`,
  `PatchSetPreviewServiceSpec.scala` — `PanelService` constructor calls updated; retired-feature
  scenarios removed (6.5f rebind hint, `existsBoundToType` 6.5k/l/m block, 7.9b companion-binding
  reject + negative).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepositorySpec.scala`
  — `findLastRunAtByOutputDataTypeId` test block removed outright.
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardPanelAclSpec.scala` — the
  `/api/panels/:id/query` test's docstring/scenario corrected to reflect outright route removal
  (not merely an ACL fix).
- `backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalBindingSpec.scala`
  — the HEL-316 text/markdown `config.dataTypeId` binding scenarios (reject-companion x2,
  apply-valid x2, reject-unknown) replaced with one "inert config field is silently ignored" test.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — "Cross-user panel type binding"
  (Task 7.5), "return 409 when deleting a data type bound to a panel", "bind/unbind a data type to
  a panel" tests removed outright (all exercised a binding path that no longer exists); the
  "dataAsOf ISO string for a bound panel" test removed, its "unbound panel" sibling renamed to
  reflect `dataAsOf` being unconditionally `None` now.

## OpenSpec / schema

- `openspec/changes/outputs-model-migration/execution-progress.md` — cycle 24 notes appended.
- `openspec/changes/outputs-model-migration/files-modified.md` — this file, cycle 24 section
  appended.

## Cycle 25 (task 4.3 complete; task 4.1's bulk started via a new live-consumer discovery)

Continued task 4.1: rewired `DataSourceService`/`SourceService`'s companion-DataType writes onto
`DataSourceRepository.upsertInferredSchema` (task 4.3, now `[x]`), and discovered + fixed a live
consumer the resume brief's enumeration didn't name — `PipelineService.analyze`/
`resolveProposalSourceSchema` also read a source's schema via the now-abandoned companion
DataType, which would have silently degraded every non-rest/sql pipeline's analyze/select/rename
step-schema propagation to empty. `DataTypeRepository`/`DataTypeService`/`MetricRepository`/
`MetricService`/`DataTypeProtocol`/routes/`Main.scala` wiring itself is NOT yet deleted — still
blocked on `PipelineRunService`'s legacy DataType writes (deliberately deferred, per the resume
brief) and needs its own re-verification pass before task 4.1's file deletions land.

### Main sources

- `backend/src/infrastructure/persistence/sources/DataSourceRepository.scala` — new
  `inferred_schema` column read/write (`upsertInferredSchema`, `DataSourceRow`/`DataSourceTable`
  gain the field), replacing the companion-`DataType` link design.md line 92 retires.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — every
  create*/refresh* path's companion-`DataType` insert/update replaced with
  `dataSourceRepo.upsertInferredSchema`; `upsertSourceDataType` rewritten as a thin wrapper over
  it; `dataTypeRepo` constructor param removed.
- `backend/src/main/scala/com/helio/services/sources/SourceService.scala` — same for
  `createSql`/`createRest` (via `CreateSourceEnvelope`) and `refresh`; `refresh`'s return type
  changed from `DataType` to `DataSource` (no companion type to return); `previewSql`/
  `previewRest`'s companion-type-sourced computed-field evaluation removed outright (ticket.md
  item 8: "the computed_fields concept is deleted" — this was the one remaining computed-field
  read path); `dataTypeRepo` constructor param removed.
- `backend/src/main/scala/com/helio/services/sources/CreateSourceEnvelope.scala` — `build` now
  takes `dataSourceRepo` instead of `dataTypeRepo`, writes `inferred_schema` directly, and returns
  `inferredSchema: Option[InferredSchemaResponse]` instead of `dataType: Option[DataTypeResponse]`.
- `backend/src/main/scala/com/helio/services/sources/SchemaInferenceFacade.scala` — `toDataFields`
  replaced with `toSchemaFields` (projects to `SchemaField {name,type}`, the `inferred_schema`
  wire shape, instead of the retired `DataField`).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala` —
  `companionDataTypeIds`/`dataTypeService`/`dataTypeRepo` bookkeeping removed outright from
  `ResolvedSource` and every rollback path — a source's inferred schema now lives inline and is
  deleted automatically with the row, so there is nothing left to roll back separately.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `analyze`'s and
  `resolveProposalSourceSchema`'s source-schema derivation rewired from
  `dataTypeRepo.findBySourceId` to `dataSourceRepo.findByIdOwned(...).inferredSchema` (the live
  consumer this cycle discovered — see above).
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` —
  `InferredFieldResponse`/`InferredSchemaResponse` moved in from the retired-in-progress
  `DataTypeProtocol`; `CreateSourceResponse.dataType` renamed to `inferredSchema`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/DataTypeProtocol.scala` —
  `InferredFieldResponse`/`InferredSchemaResponse`/`SchemaFieldResponse` removed (the first two
  moved to `DataSourceProtocol`; `SchemaFieldResponse` moved to `PipelineAnalyzeProtocol`, its only
  remaining same-package consumer, NOT to `DataSourceProtocol` — it backs the unrelated
  pipeline-analyze-step response shapes, not a source's own schema).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` —
  gained `SchemaFieldResponse` + its own `schemaFieldResponseFormat` (previously supplied via a
  `DataTypeProtocol` mixin, now removed).
- `backend/src/main/scala/com/helio/api/package.scala` — `InferredFieldResponse`/
  `InferredSchemaResponse` aliases repointed to `protocols.sources`; `SchemaFieldResponse` stays
  aliased to `protocols.pipelines`.
- `backend/src/main/scala/com/helio/api/routes/sources/SourcePreviewRoutes.scala` — `POST
  /api/sources/:id/refresh` renders `DataSourceResponse.fromDomain` instead of
  `DataTypeResponse.fromDomain`, matching `refresh`'s new return type.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `DataSourceService`/`SourceService`/
  `PipelineProposalService` construction sites drop the now-removed `dataTypeRepo`/
  `dataTypeService` positional args.
- `backend/src/main/resources/db/migration/V94__outputs_model.sql`, main sources otherwise
  untouched this cycle beyond the above — no new migration steps landed (2.10's drops still
  blocked, per plan, on 4.1's bulk deletion + 4.5).

### Tests (mechanical fallout + genuine retired-scenario rewrites)

- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceSpec.scala`,
  `DataSourceServiceCsvUrlSpec.scala`, `DataSourceServiceRestartPersistenceSpec.scala`,
  `SourceServiceSpec.scala`, `SchemaInferenceFacadeSpec.scala`, `SchemaInferenceRegressionSpec.scala`,
  `CreateSourceEnvelopeSpec.scala` — every companion-`DataType`-reading assertion rewritten to read
  `DataSourceRepository`/the source's own `inferredSchema` instead; the two "Fix D" orphan-recovery
  tests rewritten from "delete the companion DT row, refresh recreates it" to "clear
  `inferred_schema`, refresh repopulates it" (same recovery-primitive intent, new mechanism); the
  "version increments on refresh" SQL/REST refresh tests dropped (no version concept survives on a
  bare inferred schema).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala`,
  `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — every
  `Get("/api/types")`-verifies-the-auto-created-companion assertion rewritten to read
  `DataSourceRepository`/the response's own `inferredSchema` directly; the three
  DataType-ownership-ACL tests (`GET /api/types`, `PATCH`/`DELETE /api/types/:id`) switched from
  relying on `POST /api/data-sources`'s retired side effect to inserting the test `DataType`
  fixture directly via `dataTypeRepo.insert` (the still-live `DataTypeRoutes` ACL surface itself is
  untouched — only its test setup needed to stop depending on the retired auto-create).
- `backend/src/test/scala/com/helio/api/routes/ResourceTaggingSpec.scala` — the two
  companion-DataType tag-propagation tests removed outright (genuinely retired feature, not a
  rewrite target — there is no companion resource left for a tag to propagate to).
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceTeardownServiceSpec.scala` — the
  6.6a "orphan companion survives" test rewritten to "no companion is ever created"; `companionTypeOf`
  helper and its two remaining call sites removed (dead once the orphan-survives scenario no
  longer exists).
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewServiceSpec.scala`,
  `PatchSetUndoServiceSpec.scala`, `PatchSetApplyServiceSpec.scala` — `seedStaticSource`'s
  `(DataSourceId, DataTypeId)` return narrowed to `DataSourceId` (every call site already discarded
  the companion id — dead tuple element, not a behavior change).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpec.scala`,
  `PipelineApplyProposalRollbackSpec.scala`,
  `backend/src/test/scala/com/helio/api/routes/proposals/CombinedApplyProposalSpec.scala` —
  `dataTypeCount() shouldBe (beforeTypes + 1)` assertions corrected to `shouldBe beforeTypes` (no
  companion DataType minted anymore).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala`,
  `PipelineAnalyzeProposalRoutesSpec.scala` — raw-SQL fixture helpers
  (`seedPipelineWithSchema`/`seedDataSource`) switched from inserting a companion `data_types` row
  to writing `data_sources.inferred_schema` directly (translating each existing `DataField`-shaped
  literal to `SchemaField` shape in Scala, rather than rewriting ~18 call-site literals) — this is
  the live-consumer fix (`PipelineService.analyze`) surfacing at the fixture level.
- `backend/src/test/scala/com/helio/infrastructure/persistence/ResourceTagMigrationSpec.scala` —
  adds a bare `ALTER TABLE data_sources ADD COLUMN inferred_schema ...` after its deliberate V93
  pin (this spec isolates V73's own effect from V94's later, unrelated companion-type-deletion
  migration step — it cannot run V94 itself, but `DataSourceRepository`'s table mapping now always
  expects the column V94 adds).
- Mechanical positional-constructor-arg fixes (dropped `dataTypeRepo`) across ~20 test files
  constructing `DataSourceService`/`SourceService`/`PipelineProposalService` directly.

## OpenSpec

- `openspec/changes/outputs-model-migration/tasks.md` — 4.3 marked `[x]`.
- `openspec/changes/outputs-model-migration/execution-progress.md` — cycle 25 notes appended.
- `openspec/changes/outputs-model-migration/files-modified.md` — this file, cycle 25 section
  appended.
