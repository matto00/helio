## Why

`Connector[Config]` currently names a stateless behavioral SPI (test/inferSchema/fetch), but HEL-820's
epic needs `Connector` for the user-facing saved-credentialed-host entity. Renaming now, before six
sibling tickets build against the entity name, avoids painful later churn.

## What Changes

- Rename the SPI trait `Connector[Config]` -> `ConnectorDriver[Config]` and its implementations
  (`SqlConnector` -> `SqlConnectorDriver`, `RestApiConnector` -> `RestApiConnectorDriver`), plus every
  reference (DI wiring, tests, doc comments, README).
- **BREAKING**: `GET /api/connectors` -> `GET /api/connector-types`; MCP tool `list_connectors` ->
  `list_connector_types`. Response shape is unchanged (still `ConnectorMetadata[]`) — only the route
  path and tool name move. Frontend (`connectorService.ts`, `SourceTypeToggle.tsx`) and `helio-mcp`
  (`helioApi.ts`, `types.ts`, `tools/read.ts`, `scripts/verify.ts`) consumers updated in this same PR.
  Any committed prompt/skill/doc/script naming `list_connectors` in prose is also checked and updated.
- `ConnectorRegistry`/`ConnectorMetadata`/`ConnectorFieldDescriptor` names are unchanged — they
  describe connector *kinds* (metadata), a separate concept from the SPI trait being renamed here.
- `openspec/specs/connector-spi/spec.md` and `openspec/specs/connector-registry/spec.md` updated to
  the new trait/route/tool names (capability paths unchanged — behavior described is unchanged, only
  the names).
- PR body and Linear closing comment note that a locally-built `helio-mcp` `dist` will 404 against
  `/api/connectors` until rebuilt post-merge.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `connector-spi`: trait/implementation names change (`Connector[Config]` -> `ConnectorDriver[Config]`,
  `SqlConnector` -> `SqlConnectorDriver`, `RestApiConnector` -> `RestApiConnectorDriver`); behavior,
  method signatures, and semantics are unchanged.
- `connector-registry`: `GET /api/connectors` -> `GET /api/connector-types`; MCP tool `list_connectors`
  -> `list_connector_types`. Response shape, auth behavior, and registry contents are unchanged.
- `fetch-error-envelope`, `schema-inference-facade`, `connection-test-endpoint`,
  `pipeline-run-execution`, `rest-api-connector`, `assistant-conversation-loop`,
  `connector-secret-redaction`: each names `Connector[Config]`/`SqlConnector`/`RestApiConnector`/
  `Connector.testConnection`/`Connector.scala` (the file-name form) in one or more requirements;
  those requirement blocks get name-only MODIFIED/RENAMED deltas (`Connector[Config]` ->
  `ConnectorDriver[Config]`, `SqlConnector` -> `SqlConnectorDriver`, `RestApiConnector` ->
  `RestApiConnectorDriver`, `Connector.testConnection` -> `ConnectorDriver.testConnection`,
  `Connector.scala` -> `ConnectorDriver.scala`). No behavior described by any of these seven
  capabilities changes — this is the AC-4-mandated sweep to avoid a second instance of the HEL-804
  stale-FQN-after-rename drift. (Re-derived via the widened pattern
  `\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.testConnection\b|\bConnector\.scala\b`
  across all of `openspec/specs/` — round-3 and round-4 design-gate findings: earlier, narrower
  patterns omitted the `Connector.testConnection` and `Connector.scala` file-name forms and missed
  `assistant-conversation-loop` and `connector-secret-redaction` respectively.)

## Non-goals

- No new `Connector` entity (saved credentialed host) — that is later epic scope (HEL-826+).
- No behavior change to `testConnection`/`inferSchema`/`fetch`, registry contents, or response shape.
- No fix for HEL-804's existing stale-FQN drift — out of scope, tracked separately.
- No deprecation window/versioning for the moved endpoint (explicit resolved decision — all callers
  are first-party and updated atomically).

## Impact

- Backend, 18 main + 26 test files (44 total; re-derived via
  `grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|Connector\[' --include=*.scala backend/src`):
  - Main: `Connector.scala`, `SqlConnector.scala`, `RestApiConnector.scala`, `ConnectorRegistry.scala`,
    `SchemaInferenceEngine.scala`, `CreateSourceEnvelope.scala`, `SourceService.scala`,
    `ConnectionTest.scala`, `ConnectorRoutes.scala`, `ConnectorProtocol.scala`, plus DI wiring
    (`app/Main.scala`, `api/ApiRoutes.scala`) and doc-comment-only references (compiler-invisible —
    will not be caught by a compile-driven rename): `domain/engine/PipelineRowJson.scala`,
    `domain/engine/InProcessPipelineEngine.scala`, `ai/ClaudeWireModels.scala`,
    `ai/HttpClaudeTransport.scala`, `services/sources/ContentSourceSupport.scala`,
    `services/pipelines/PipelineService.scala`, `services/pipelines/PipelineRunService.scala`,
    `services/pipelines/PipelineProposalService.scala`.
  - Tests (26): every `backend/src/test/**` file matched by the grep above — includes the 6 originally
    enumerated (`NewConnectorInferenceSpec`, `RestApiConnectorSpec`, `SqlConnectorSpec`, `ConnectorSpec`,
    `CreateSourceEnvelopeSpec`, `SourceServiceSpec`) plus `ConnectorRegistrySpec`, `ApiRoutesSpec`,
    `ApiTokenAuthSpec`, `AuditMutationInstrumentationSpec`, `InProcessPipelineEngineSpec`,
    `HookRoutesSpec`, `PipelineAnalyzeProposalRoutesSpec`, `ComputedFieldsRoutesSpec`,
    `DataSourceRoutesSpec`, `PipelineRunRoutesSpec`, `ApplyProposalSpecBase`, `MfaApiRoutesSpec`,
    `CombinedApplyProposalSpecBase`, `UploadRoutesSpec`, `PipelineRunServiceSpec`,
    `SchemaInferenceRegressionSpec`, `PipelineApplyProposalSpecBase`,
    `DashboardPanelAclSpec`, `DataTypeDataSourceAclSpec`, `ApiRoutesCorsErrorHandlingSpec`,
    `ConnectorRoutesSpec` (route-name references only, not trait references).
  - `README.md` (`domain/connectors/`).
- Frontend: `connectorService.ts`, `SourceTypeToggle.tsx` + tests, `TestConnectionAffordance.tsx`
  (confirmed doc-comment reference to `Connector[Config]` at line 3).
- `helio-mcp`: `helioApi.ts`, `types.ts`, `tools/read.ts`, `scripts/verify.ts`; prose sweep also covers
  any other committed prompt/skill/doc/script naming `list_connectors`.
- `openspec/specs/`: `connector-spi/spec.md`, `connector-registry/spec.md`, `fetch-error-envelope/spec.md`,
  `schema-inference-facade/spec.md`, `connection-test-endpoint/spec.md`, `pipeline-run-execution/spec.md`,
  `rest-api-connector/spec.md`, `assistant-conversation-loop/spec.md`, `connector-secret-redaction/spec.md`
  (9 total — see the widened-pattern note above). Purpose paragraphs in `connector-spi`,
  `connector-registry`, `fetch-error-envelope`, `schema-inference-facade`, and `connection-test-endpoint`
  (5 of the 9 — `pipeline-run-execution`, `rest-api-connector`, `assistant-conversation-loop`, and
  `connector-secret-redaction` have no old-name text in their Purpose) also need a manual post-archive
  edit (a MODIFIED-requirements delta cannot reach `## Purpose` text).
