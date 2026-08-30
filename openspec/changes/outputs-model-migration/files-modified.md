# Files modified (this cycle, cycle 21) — task 3.12 + partial 3.2

- `backend/src/main/scala/com/helio/domain/model/model.scala` — `Output` gains a
  `schema: Vector[SchemaField] = Vector.empty` field (additive default) so it can round-trip its
  derived `{name, type}` schema.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala`
  — `rowToDomain`/`insertInternal` populate the new `schema` field; new `findAllByOwner`
  (owner-scoped paged listing, the `WorkspaceContextService.assemble` replacement for
  `DataTypeRepository.findAll`) and `updateSchemaInternal` (test/internal schema update) methods.
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala` — task
  3.12: `dataTypeService: DataTypeService` constructor param replaced with
  `outputRepo: OutputRepository` (same slot); new trailing `nodeSnapshotRepoOpt` param;
  `assemble`'s `typesF`, `toDataTypeEntry`, and `buildPipeline`'s representative-Output resolution
  all rewired onto Outputs/`NodeSnapshotRepository`; both new `outputRepo`-consuming call sites
  degrade `outputRepo == null` to empty rather than NPE (real regression caught by
  `ApiTokenAuthSpec`, fixed). `asNumeric`/`computeColumnStats`/`sanitizeSampleRows` untouched
  (HEL-631 caution).
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceSearchService.scala` — task 3.2
  (partial, forced by 3.12's signature change): `dataTypeService` constructor param replaced with
  `outputRepo: OutputRepository`; `find`'s DataType branch and `getResource`'s DataType case
  rewired onto `OutputRepository`, with the same null-degrades-to-empty guard on `find`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `workspaceContextService`/
  `workspaceSearchService` construction sites updated to pass `outputRepoOpt.orNull`/
  `nodeSnapshotRepoOpt` instead of `dataTypeService`.
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` — full
  fixture rewrite: `createPipeline` now creates a real Output (`nodeStepId = None`) alongside its
  legacy companion-DataType back door; `setDataTypeFields`/row-writing helpers retargeted onto
  `OutputRepository.updateSchemaInternal`/`NodeSnapshotRepository.overwriteRows`; the
  now-nonexistent "source-companion DataType surfaces in `dataTypes`" assertions (4.2, 4.3, HEL-372
  4.3, 4.6b) rewritten to assert the new, correct behavior (a companion type is never surfaced;
  every Output is unconditionally `pipelineOutput = true`).
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceSearchServiceSpec.scala` — same
  class of fixture rewrite as above; the "source-companion type" find/getResource-parity tests
  retargeted onto a real Output.
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceAgentContextSpec.scala`,
  `.../api/routes/ResourceTaggingSpec.scala`, `.../api/routes/patchsets/RefinementRoutesSpec.scala`,
  `.../services/patchsets/RefinementServiceSpec.scala` — mechanical constructor-call updates
  (`dataTypeService` → `outputRepo`).
- `backend/src/test/scala/com/helio/api/routes/proposals/DashboardAuthoringRoutesSpec.scala`,
  `.../services/proposals/AuthoringTelemetrySpec.scala` — beyond the mechanical constructor swap,
  both fixtures' shared "pipeline-output DataType" grounding fixture now also creates a real
  pipeline + Output (the vestigial `DataType`'s id is set equal to the Output's id so existing
  `.id.value` call sites keep resolving); `dashboardProposalService` now also passes the real
  `outputRepo` (was `null`), needed for "output"-kind panel binding validation.
- `backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringServiceSpec.scala` —
  mechanical constructor-call update only (doesn't exercise real grounding via DB).
- `backend/src/test/scala/com/helio/api/routes/assistant/AssistantConversationRoutesSpec.scala` —
  `assistantServiceWithSearch` rewired to take/mock an `OutputRepository` instead of
  `DataTypeRepository`/`DataTypeService` for its scripted `find`/`get_resource` scenario.
- `backend/src/test/scala/com/helio/services/assistant/AssistantServiceSpec.scala` — new
  `dataTypeBackedOutputRepo` adapter (an `OutputRepository` subclass forwarding to the file's
  already-stubbed `DataTypeRepository` mocks, translating `DataType` → `Output`) lets every
  existing `dtRepo`-stubbing test block keep driving `find`/`get_resource` unchanged, with zero
  per-test-block edits.
- `backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorSpec.scala` —
  `newExecutor` now wires its existing `outputRepo` param into `WorkspaceContextService`/
  `WorkspaceSearchService` (previously only used for `DashboardProposalService`); the two tests
  exercising `get_resource("dataType")`/`find` directly now stub a real `OutputRepository` mock
  alongside their existing `DataTypeRepository` stub (`PanelCapabilityService`'s still-DataType-keyed
  capability half is unaffected, task 3.11 not yet done).
- `openspec/changes/outputs-model-migration/tasks.md` — 3.12 marked `[x]` with a detailed
  completion note; 3.2 annotated as partial (only `WorkspaceSearchService`'s DataType branch
  landed, forced by 3.12; `WorkspaceTeardownRepository`/`DashboardContentsService`/
  `AssistantToolExecutor`'s remaining DataType/Metric branches are NOT done).
