# Files modified — CS2c-2 (backend DataSource ADT)

Compact map for the evaluator. One bullet per source file; tests grouped at the bottom.

## Backend domain
- `backend/src/main/scala/com/helio/domain/DataSource.scala` — new sealed trait + 4 subtypes (`CsvSource`, `RestSource`, `SqlSource`, `StaticSource`), typed `CsvSourceConfig`, and standalone `DataSourceKind` parse/unparse helpers
- `backend/src/main/scala/com/helio/domain/model.scala` — drop the old flat `DataSource` case class and the `SourceType` sealed-trait enum; `SqlSourceConfig` remains here for now (other config types stay where they were)

## Backend infrastructure
- `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala` — typed `rowToDomain` dispatching on the `source_type` column; `domainToRow` flattens back; adds `readRawConfig` and `updateStaticPayload` for the static-source `{columns, rows}` blob path used by the engine + Spark submitter

## Backend protocol
- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — discriminated-union `RootJsonFormat` over the new `DataSourceResponse` ADT (sealed trait + 4 subtype responses); per-subtype response carries its typed `config` payload; `DataSourceResponse.fromDomain` redacts REST tokens / SQL passwords before serialization
- `backend/src/main/scala/com/helio/api/protocols/DataSourceConfigCodec.scala` — new — encode/decode the per-subtype config payloads to/from the JSON column at the repository boundary; tolerates the legacy `filePath` CSV key (HEL-237 carryover)

## Backend services
- `backend/src/main/scala/com/helio/services/DataSourceService.scala` — typed ADT consumption everywhere; `createStatic` writes the payload via `updateStaticPayload`; `delete` matches on `CsvSource` for the file-cleanup path
- `backend/src/main/scala/com/helio/services/SourceService.scala` — typed ADT consumption; `createRest` / `createSql` build typed sources; `refresh` / `preview` pattern-match on `SqlSource` / `RestSource` subtypes
- `backend/src/main/scala/com/helio/services/SourceConfigParsing.scala` — shrunk to a thin format re-export; the typed config decoding moved to `DataSourceConfigCodec` at the repo boundary

## Backend routes
- `backend/src/main/scala/com/helio/api/routes/SourceRoutes.scala` — JSON dispatcher now reads `type` (was `sourceType`)
- `backend/src/main/scala/com/helio/api/routes/SourcePreviewRoutes.scala` — same — `/sources/infer` reads `type`

## Backend (CS2c-3 territory, minimum mechanical updates to consume the typed ADT)
- `backend/src/main/scala/com/helio/api/routes/PipelineRunRoutes.scala` — `_: RestSource | _: SqlSource` subtype matches replace the deleted `SourceType.{RestApi,Sql}`; the in-process engine call sites pass `dataSourceRepo` for static-payload lookup
- `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` — `loadRows` now takes the typed ADT + a `DataSourceRepository`; static-source rows resolved via `readRawConfig` rather than the deleted `config: JsValue` field on the ADT
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — same pattern — typed ADT + repo-based static payload lookup

## Frontend
- `frontend/src/types/models.ts` — `DataSource` becomes a discriminated union over `type` with per-subtype `config`; adds `DataSourceKind`, `CsvSource` / `RestSource` / `SqlSource` / `StaticSource` types, `SqlSourceConfig`, and `isXxxSource` narrowing helpers
- `frontend/src/services/dataSourceService.ts` — payloads renamed `sourceType` -> `type`; `refreshSource` takes a typed `DataSourceKind`; SqlSourceConfig re-exported from `types/models`
- `frontend/src/features/sources/sourcesSlice.ts` — `SqlSourceConfig` import moved to the typed-models module; thunk wiring unchanged
- `frontend/src/components/DataSourceList.tsx` — narrows on `source.type` (was `source.sourceType`); `handleRefresh` takes a `DataSourceKind`
- `frontend/src/components/SourceDetailPanel.tsx` — same narrow; `labelForKind` typed against `DataSourceKind`

## OpenSpec (spec.md updates for wire-shape rename)
- `openspec/specs/csv-upload-connector/spec.md` — `sourceType = csv` -> discriminator `type = "csv"`
- `openspec/specs/data-source-persistence/spec.md` — Static persistence wording reflects the new `updateStaticPayload` / `readRawConfig` repo accessors
- `openspec/specs/frontend-data-sources-page/spec.md` — badge wording + Manual tab payload reflects `type: "static"`
- `openspec/specs/rest-api-connector/spec.md` — `sourceType` -> `type`; new credential-redaction requirement replacing the old "config never returned" wording
- `openspec/specs/static-data-connector/spec.md` — request/response wording uses `type` discriminator

## Tests (updated + new)
- `backend/src/test/scala/com/helio/domain/DataSourceSpec.scala` — **new** — pattern-match exhaustiveness + `kind` correctness per subtype + `DataSourceKind.parseKind` round-trip
- `backend/src/test/scala/com/helio/api/protocols/DataSourceProtocolSpec.scala` — **new** — discriminated-union round-trip per subtype + legacy `filePath` tolerance + credential redaction (REST bearer, REST api-key, SQL password)
- `backend/src/test/scala/com/helio/infrastructure/DataSourceRepositorySpec.scala` — updated fixtures to ADT subtypes; new "round-trips each ADT subtype" test
- `backend/src/test/scala/com/helio/api/protocols/AggregatorRegressionSpec.scala` — `DataSourceResponse` round-trip rewritten for the discriminated-union shape
- `backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala` — body asserts `body.\`type\``; request bodies use `type` discriminator
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — DataSource literals migrated to typed subtypes; CreateSourceRequest uses `type` discriminator; JSON literals use `"type":"static"`
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` — `staticDs` helper uses mock-repo `readRawConfig` + payload map; submitter tests pass `dsRepoForSubmit`
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — join-op tests use mock repo's `readRawConfig` for static payload; CSV regression tests construct typed `CsvSource`
- `backend/src/test/scala/com/helio/infrastructure/DataTypeRepositorySpec.scala` — fixture switched to `CsvSource`
- `frontend/src/features/sources/sourcesSlice.test.ts` — fixtures typed against `DataSource`; assertions migrated to `type`
- `frontend/src/components/CreatePipelineModal.test.tsx` — `testDataSources` typed
- `frontend/src/components/PipelineDetailPage.test.tsx` — `SourceItem` aliased to `DataSource`; fixtures inline typed configs

## Test counts
- Backend: 511 → 531 (16 new ADT/protocol/redaction + 1 new repo round-trip = 17 added; existing 511 still green)
- Frontend: 660 → 664 (typed fixtures expanded coverage indirectly; no new test files)
