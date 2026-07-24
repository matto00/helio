## Backend

- `backend/src/main/scala/com/helio/domain/Connector.scala` — widened `ConnectorMetadata` with `requiredFields: Vector[ConnectorFieldDescriptor] = Vector.empty`; added `ConnectorFieldDescriptor(name, label, secret)`; corrected the trait doc comment (it previously said registry aggregation works against `Connector[_]` existentials — now describes the actual dependency-free-value mechanism).
- `backend/src/main/scala/com/helio/domain/SqlConnector.scala` — populated `SqlConnector.metadata.requiredFields` (7 fields from `SqlSourceConfigPayload`; `password` marked secret).
- `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` — moved `ConnectorMetadata` into a new dependency-free `RestApiConnector` companion-object `val metadata`; the class's `override val metadata` now delegates to it; populated `requiredFields` (`url`, non-secret).
- `backend/src/main/scala/com/helio/domain/ConnectorRegistry.scala` — new. Aggregates all 7 kinds' `ConnectorMetadata` (`sql`/`rest_api` from the companion-object vals; `csv`/`static`/`text`/`pdf`/`image` as hand-authored static values). Uses literal kind strings (not `DataSourceKind.X`) to avoid a circular-`<clinit>` NPE with `DataSourceKind.All` (see root-cause note below).
- `backend/src/main/scala/com/helio/domain/DataSource.scala` — `DataSourceKind.All` now derives from `ConnectorRegistry.all.map(_.kind).toSet` instead of a literal `Set`.
- `backend/src/main/scala/com/helio/api/protocols/ConnectorProtocol.scala` — new. `ConnectorMetadataResponse`/`ConnectorFieldDescriptorResponse` wire types + spray-json formats.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed in `ConnectorProtocol`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exported `ConnectorMetadataResponse`/`ConnectorFieldDescriptorResponse` for `import com.helio.api._` call sites (matches the existing re-export pattern for every other protocol type).
- `backend/src/main/scala/com/helio/api/routes/ConnectorRoutes.scala` — new. `GET /api/connectors`, no repository dependency, wraps `ConnectorRegistry.all`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — mounted `new ConnectorRoutes(authenticatedUser).routes` in the authenticated tree alongside `DataSourceRoutes`/`SourceRoutes`.

## Backend tests

- `backend/src/test/scala/com/helio/domain/ConnectorRegistrySpec.scala` — new. Drift-detection test: asserts `ConnectorRegistry.all.map(_.kind).toSet == DataSourceKind.All`, and both equal an independently-authored literal 7-kind set; asserts SQL/REST `requiredFields` names explicitly.
- `backend/src/test/scala/com/helio/api/routes/ConnectorRoutesSpec.scala` — new. `GET /connectors` HTTP-layer coverage: 7 entries, non-empty `requiredFields`, no secret values in the serialized body, correct `secret` flags per kind.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — added one test to the existing "Protected routes" 401 suite for `GET /api/connectors` without auth.
- `backend/src/test/scala/com/helio/domain/RestApiConnectorSpec.scala` — **behavior-driven update** (task 1.2a): the `metadata` assertion now includes the real, non-empty `requiredFields` the production connector's metadata genuinely gained.
- `backend/src/test/scala/com/helio/domain/SqlConnectorSpec.scala` — same behavior-driven update as above, for `SqlConnector.metadata`.

## helio-mcp

- `helio-mcp/src/types.ts` — added `ConnectorMetadataResponse`/`ConnectorFieldDescriptorResponse` mirrors.
- `helio-mcp/src/helioApi.ts` — added `listConnectors()` (`GET /api/connectors`).
- `helio-mcp/src/tools/read.ts` — registered the `list_connectors` read tool, following the existing `guarded(() => api.xxx())` pass-through pattern.
- `helio-mcp/scripts/verify.ts` — added a `list_connectors` smoke-check section (helio-mcp has no unit-test framework; `scripts/verify.ts` is this package's established live-verification pattern for every other read tool).

## Frontend

- `frontend/src/features/sources/services/connectorService.ts` — new. `listConnectors()` service call against `GET /api/connectors`.
- `frontend/src/features/sources/ui/SourceTypeToggle.tsx` — now renders buttons from the fetched registry instead of a hardcoded list. Initializes from (and falls back to, on fetch failure) a `FALLBACK_CONNECTORS` constant that mirrors the pre-registry hardcoded button set byte-for-byte, so the toggle never flashes empty and never regresses.
- `frontend/src/features/sources/ui/SourceTypeToggle.test.tsx` — new. Asserts the same 7 buttons/order/labels render once the registry fetch resolves, the active-kind class, the onChange wiring, and the fallback/error-resilience behavior.
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — added a `jest.mock("../services/connectorService", …)` resolving the same 7-kind/order/label payload, since `SourceTypeToggle` now fetches on mount and this test file doesn't otherwise mock that module. Necessary consequence of the new fetch wiring, not a change to any assertion's expected behavior.

## OpenSpec

- `openspec/changes/connector-registry-capability-metadata/tasks.md` — all tasks marked complete.

## Root-cause note (systematic-debugging)

- **Root cause**: mutual circular static initialization — `ConnectorRegistry.all`'s content-kind entries originally referenced `DataSourceKind.Csv`/`.Static`/`.Text`/`.Pdf`/`.Image`, which forced `DataSourceKind$`'s `<clinit>` to run; `DataSourceKind$`'s `<clinit>` reaches its own `All = ConnectorRegistry.all.map(_.kind).toSet` field, re-entering `ConnectorRegistry$` while it was still mid-construction (its `all` field not yet assigned) — JVM class-init re-entrancy returns the partially-constructed singleton, so `ConnectorRegistry.all` read `null`, and `.map` on `null` threw `NullPointerException`.
- **Probe**: `sbt "testOnly com.helio.domain.ConnectorRegistrySpec ..."` — failed with `ExceptionInInitializerError` / `NullPointerException` at `DataSourceKind$.<clinit>(DataSource.scala:169)` called from `ConnectorRegistry$.<clinit>`.
- **Fix**: `ConnectorRegistry`'s static entries now use literal kind strings (`"csv"`, `"static"`, etc.) instead of `DataSourceKind.X` constants — matching the existing precedent in `SqlConnector`/`RestApiConnector.metadata`, which already use literal `"sql"`/`"rest_api"`. This makes the dependency strictly one-directional (`DataSourceKind` → `ConnectorRegistry`, never the reverse). Verified: `ConnectorRegistrySpec`, `DataSourceSpec`, and the full `sbt test` suite (1776 tests) all pass after the fix.
