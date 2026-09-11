## Why

HEL-1074 (Migration A) already moved manual/static source storage onto the dedicated `dataset_rows`
table and rewrote `data_sources.source_type` to `'dataset'` in the DB, but deliberately left the
Scala domain model and connector registration unchanged — the ADT member is still named
`StaticSource` and `ConnectorRegistry` still registers `kind = "static"`. Until this lands, the
domain layer and the DB are out of sync on the kind's canonical name, and there is no `"dataset"`
wire value a client can send.

## What Changes

- Rename `StaticSource` to `DatasetSource` (kept as the sole ADT member for this connector kind —
  no separate lingering "static" case) with `kind = "dataset"`.
- Register the connector in `ConnectorRegistry` under `kind = "dataset"` (was `"static"`),
  preserving its existing `displayName`/`authKind`/`requiredFields`.
- `DataSourceKind.parseKind` accepts `"static"` as a one-minor-release wire alias, resolving it to
  `"dataset"`; `DataSourceKind.All` (registry-derived, HEL-484) naturally now contains `"dataset"`,
  not `"static"`.
- Update every backend call site pattern-matching on `StaticSource`/`"static"` literal (repository,
  service, pipeline engine, Spark submitter, protocols) to the renamed type/kind, keeping `"static"`
  accepted only at the wire-parsing boundary.
- Update frontend/e2e/MCP call sites that send or switch on `type: "static"` so none silently break
  when the server starts returning `"dataset"` on read; `"static"` remains an accepted request value.
- **BREAKING** (internal only, no public wire break): the Scala class `StaticSource` is renamed —
  any external code compiled against it (none in this repo outside `com.helio`) would need updating.

## Capabilities

### New Capabilities
(none — `dataset` is a rename/registration of an existing connector kind, not a new capability)

### Modified Capabilities

- `connector-registry`: registered kind list changes from including `static` to including `dataset`;
  `parseKind`/`canonicalize` gain the `static` -> `dataset` alias behavior.
- `static-data-connector`: the connector's canonical stored/returned `type`/`source_type` becomes
  `dataset`; `static` continues to be accepted on write.
- `frontend-data-sources-page`: `AddSourceModal`'s Manual-tab create POST and `DataSourceList`'s
  status badge now key off `type: "dataset"` (badge copy unchanged: still "Static").
- `pipeline-proposal-analyze-api`: inline-root resolution treats `type: "static"` and
  `type: "dataset"` identically.
- `pipeline-proposal-contract`: the inline-root `type` enum gains `"dataset"` alongside `"static"`.
- `pipeline-proposal-apply`: structural pre-validation accepts `"dataset"` as a recognized inline
  root type alongside `"static"`.

## Impact

- `backend/src/main/scala/com/helio/domain/model/DataSource.scala` (ADT rename, `DataSourceKind`)
- `backend/src/main/scala/com/helio/domain/connectors/ConnectorRegistry.scala` (registered kind)
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala`,
  `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala`,
  `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala`,
  `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjection.scala`,
  `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala`,
  `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala`,
  `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`,
  `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala`,
  `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala`,
  `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProposalProtocol.scala`,
  `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` (pattern-match/kind-string
  call sites)
- `backend/src/test/scala/com/helio/**` (`ConnectorRegistrySpec` and any fixture referencing
  `StaticSource`/`"static"` as the stored kind)
- `frontend/src/**`, `e2e/**`, `helio-mcp/**` — any consumer sending/switching on `type: "static"`
- No new migration expected (verify V107 is still free before committing if one becomes necessary)
