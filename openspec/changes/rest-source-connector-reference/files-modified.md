# Files modified — HEL-822 REST source references a Connector

## Domain model / wire contract

- `backend/src/main/scala/com/helio/domain/model/model.scala` — `RestApiConfig` replaces `url`/`auth` with `connectorId`/`endpoint`/`queryParams`/`body`; adds `EphemeralRestConfig` (Decision 1c).
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — `RestApiConfigPayload` carries both `connectorId` and legacy `url` (dual-support); `toDomain`/`fromDomain` rewritten; `HasSecrets[RestApiConfigPayload]` emptied (no secret fields remain).
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceConfigCodec.scala` — `decodeRest` returns `Either[String, RestApiConfig]` (Decision 6: valid / `"legacy-unmigrated"` / `"malformed: ..."`), never silently defaults.

## Connector-side request composition

- `backend/src/main/scala/com/helio/domain/connectors/ConnectorAuthShape.scala` — new: the non-secret auth shape stored in `connectors.config` for `kind = "rest_api"`.
- `backend/src/main/scala/com/helio/domain/connectors/ConnectorDriver.scala` — adds `ConnectorResolveContext` (`Owned(user)` / `Internal`); trait methods gain a `resolveContext` parameter.
- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` — resolves `connectorId` → `Connector` → decrypted credential → composed request (Decision 3/4); adds `fetchEphemeral`/`inferSchemaEphemeral`/`testConnectionEphemeral` (Decision 1c); `metadata.requiredFields` now `["connectorId"]`.
- `backend/src/main/scala/com/helio/domain/connectors/SqlConnectorDriver.scala` — threads the new `resolveContext` param (ignored; no Connector reference).
- `backend/src/main/scala/com/helio/services/sources/ConnectionTest.scala`, `CreateSourceEnvelope.scala` — thread `resolveContext`/`Owned(user)` through the generic `ConnectorDriver[Config]` call sites.

## dependentCount seam (highest-risk item)

- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — `countRestSourcesReferencing(connectorId)` (JSONB-extract, privileged pool); `updateConfigInternal`; `findAllRestApiRawInternal`; sentinel handling in `rowToDomain` for a `decodeRest` `Left`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorRepository.scala` — `findByIdInternal` (Decision 11, pipeline-execution path).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires the real `dependentCount` collaborator at `connectorEntityServiceOpt`'s construction site; promotes `connectorRepoOpt` above `sourceService` so both share one `ConnectorRepository`.

## Dual-support (create / infer / test / pipeline-proposal)

- `backend/src/main/scala/com/helio/services/sources/ImplicitConnectorConfig.scala` — new: shared pure helper for both synthesis points (create-time, migration).
- `backend/src/main/scala/com/helio/services/sources/SourceService.scala` — `createRest` branches on `connectorId`/`url`; bare-`url` synthesizes an implicit Connector via `ImplicitConnectorConfig` + `ConnectorRepository.create`. `inferRest`/`testRest` gain `user`, branch to ephemeral vs. owned resolution; reject a request carrying `auth`.
- `backend/src/main/scala/com/helio/api/routes/sources/SourcePreviewRoutes.scala` — threads `user` to `inferRest`/`testRest`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `resolveInlineSourceSchema` threads the acting user and branches inline `rest_api` sources the same way.
- `backend/src/main/scala/com/helio/services/assistant/AssistantToolExecutor.scala` — `testRest` call threads `user`.
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — `RestSource`/`SqlSource` fetch calls pass `ConnectorResolveContext.Internal` (Decision 11).

## Migration

- `backend/src/main/scala/com/helio/services/sources/RestSourceConnectorMigration.scala` — new: idempotent startup migration; branches valid / legacy-owned / legacy-ownerless / malformed; URL split via Pekko's `Uri` parser; scaladoc documents Decision 8's irreversibility.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `ConnectorRepository`/`ConnectorCredentialRepository`, wires them into `RestApiConnectorDriver`, invokes the migration before `HttpServer.start`.

## Test files (updated for the new wire/domain shape, plus new coverage)

Existing specs updated to the new `RestApiConfig`/`RestApiConfigPayload` shape and the `ConnectorResolveContext`-carrying trait signature: `ApiRoutesSpec`, `AuditMutationInstrumentationSpec`, `AggregatorRegressionSpec`, `DataSourceProtocolSpec`, `PipelineApplyProposalSpecBase`, `PipelineRunRoutesSpec`, `DataSourceRoutesSpec`, `ConnectorRegistrySpec`, `ConnectorSpec`, `NewConnectorInferenceSpec`, `RestApiConnectorDriverSpec` (rewritten to exercise the ephemeral path directly), `SqlConnectorDriverSpec`, `InProcessPipelineEngineSpec`, `DataSourceSpec`, `PaginationSpec`, `DataSourceRepositorySpec`, `AssistantServiceSpec`, `AssistantToolExecutorSpec`, `PipelineRunServiceSpec`, `CreateSourceEnvelopeSpec`, `SourceServiceSpec`, `SparkJobSubmitterSpec`.

New:

- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/ConnectorRepositorySpec.scala` (appended) — real `countRestSourcesReferencing`/409-block/unblock/cross-connector-isolation coverage (tasks 3.3/3.4).
- `backend/src/test/scala/com/helio/services/sources/RestSourceConnectorMigrationSpec.scala` — idempotency, ownerless-row skip, malformed-row skip, and real round-trip proof (bearer + api-key-in-query) against a local stub HTTP server (tasks 4.1a/4.4/4.5/4.6).

## Non-repo (local-only, gitignored)

- `backend/.env` — added `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` (was entirely absent from this worktree's local `.env`; required once any code path writes a `connector_credentials` row, which HEL-822's dual-support create path is the first to reach for several existing test fixtures).


## Cycle-2 (skeptic final-gate CRs)

- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` — CR1: the advertised `rest_api` tool schema/examples updated to `{connectorId, endpoint?, method?, queryParams?, headers?}`; `auth?` removed (a hard 400 everywhere this ticket touched).
- `backend/src/test/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemasSpec.scala` — CR1: pins now assert `RestApiConfigPayload.toDomain` succeeds on the rest examples (not just spray-json decode).
- `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverConnectorResolutionSpec.scala` — new: CR2's header-precedence scenarios (non-colliding / source-wins-on-collision) plus real bearer-credential-decryption coverage, DB-backed (the ephemeral-only `RestApiConnectorDriverSpec` can't reach `buildResolvedRequest`).
- `backend/src/main/scala/com/helio/services/sources/ConnectorEntityService.scala` — CR3: `create` allows an empty credential only when `config.authType == "none"` (task 2.1b); `create`/`update` strip any client-supplied `implicit` and set it server-side, preserving an existing Connector's `implicit` across `update` (task 1.2b).
- `backend/src/test/scala/com/helio/api/routes/sources/ConnectorEntityRoutesSpec.scala` — CR3: new tests for both of the above (task 2.1b/1.2b).
- `backend/src/main/scala/com/helio/domain/connectors/ConnectorAuthShape.scala` — root-caused fix found while adding CR2's coverage: the bare `jsonFormat5` format treated every field (including `implicit`, added by this ticket) as required, so every pre-HEL-822 `connectors.config` row would silently parse-fail and fall back to `authType = "none"` with empty `defaultHeaders` — a real production regression, not just a test-fixture issue. Hand-rolled format defaults each optional-with-a-Scala-default field explicitly.
- `backend/src/test/scala/com/helio/domain/connectors/ConnectorAuthShapeSpec.scala` — new: regression coverage for the above.
- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` — non-blocking note (a): a source/Connector-default header colliding with the auth header's own name no longer rides alongside it (auth header always wins); covered by the new resolution spec.
- `backend/src/main/scala/com/helio/services/sources/RestSourceConnectorMigration.scala`, `backend/src/main/scala/com/helio/services/sources/SourceService.scala` — non-blocking note (b): `splitUrl` now reports (not silently swallows) a legacy URL with repeated query keys — `RestApiConfig.queryParams`'s `Map[String,String]` shape can only keep the last occurrence; the migration logs a named warning rather than collapsing silently.
