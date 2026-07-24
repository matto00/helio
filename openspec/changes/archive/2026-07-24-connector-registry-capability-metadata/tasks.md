## 1. Backend — metadata + registry

- [x] 1.1 Widen `ConnectorMetadata` (`domain/Connector.scala`) with `requiredFields: Vector[ConnectorFieldDescriptor] = Vector.empty` (a default, NOT a bare required field — this is what keeps the widening genuinely additive: the five existing 4-arg construction sites — `RestApiConnectorSpec.scala:76`, `SqlConnectorSpec.scala:172`, `ConnectorSpec.scala:19`/`:57`, `NewConnectorInferenceSpec.scala:23`, `CreateSourceEnvelopeSpec.scala:29` — keep compiling untouched); add `ConnectorFieldDescriptor(name: String, label: String, secret: Boolean)`.
- [x] 1.2 Move `RestApiConnector`'s `ConnectorMetadata` value into a new `RestApiConnector` companion object as a dependency-free `val metadata` (no `ActorSystem`/constructor needed to read it); have the class's `override val metadata` delegate to `RestApiConnector.metadata` so the trait member is still satisfied on instances. `SqlConnector.metadata` needs no change (already a dependency-free `object` member). Populate `requiredFields` on both, matching `SqlSourceConfigPayload`/`RestApiConfigPayload`'s actual required fields (mark `password`/bearer-token/api-key fields `secret = true`).
- [x] 1.2a Update the two existing tests that assert the **full** `ConnectorMetadata` value of these two production connectors — `RestApiConnectorSpec.scala:76-83` and `SqlConnectorSpec.scala:172-179` (both `metadata shouldBe ConnectorMetadata(kind=…, displayName=…, supportsIncremental=…, authKind=…)`) — to include the real, non-empty `requiredFields` populated in Task 1.2. This is a *behavior-driven* update (the production value they assert genuinely changed), not "editing a test to accommodate new code" — disclose it as such in the commit. Do NOT touch `ConnectorSpec.scala:19`/`:57`, `NewConnectorInferenceSpec.scala:23`, or `CreateSourceEnvelopeSpec.scala:29` — those are self-contained fixtures unaffected by Task 1.2's production changes and stay genuinely untouched (the `Vector.empty` default keeps them compiling as-is).
- [x] 1.3 Create `ConnectorRegistry` (`domain/ConnectorRegistry.scala`) with `all: Vector[ConnectorMetadata]`: `sql`/`rest_api` sourced from `SqlConnector.metadata`/`RestApiConnector.metadata` (the companion-object `val`s — never an instance member); static entries for `csv`/`static`/`text`/`pdf`/`image` with hand-authored `requiredFields` from their existing config payload shapes. Verify every entry is reachable without constructing anything requiring an `ActorSystem` or other runtime dependency.
- [x] 1.4 Update `DataSourceKind.All` (`domain/DataSource.scala`) to derive from `ConnectorRegistry.all.map(_.kind).toSet`; verify `parseKind` behavior is unchanged and that this compiles/works from `DataSourceKind`'s existing no-`ActorSystem` call sites (`DataSourceProtocol.scala`, `DataSourceRepository.scala`, `DataSourceSpec.scala`).
- [x] 1.5 Fix `Connector.scala`'s trait doc comment — it currently says "Registry aggregation (HEL-484) works against `Connector[_]` existentials," which is now wrong; update it to describe the actual mechanism (aggregating dependency-free static `ConnectorMetadata` values, sourced from an `object`'s member or a class's companion-object `val`, never from a live instance), matching the short-names-only house style of the doc comment's other contract blocks.

## 2. Backend — API endpoint

- [x] 2.1 Add wire response types (`ConnectorMetadataResponse`, `ConnectorFieldDescriptorResponse`) + JSON formats (as a new `ConnectorProtocol` trait) in `api/protocols/`.
- [x] 2.2 Add `new ConnectorProtocol` to `JsonProtocols.scala`'s mixin composition (alongside the existing per-feature protocol traits like `DataSourceProtocol`/`PipelineProtocol`) — required for `ConnectorRoutes` to compile against the new response formats; `JsonProtocols` has no wildcard/reflective fallback.
- [x] 2.3 Add `ConnectorRoutes` (`api/routes/ConnectorRoutes.scala`) exposing `GET /api/connectors`, no repo dependency, mapping `ConnectorRegistry.all` to the response type.
- [x] 2.4 Mount `new ConnectorRoutes(authenticatedUser).routes` in `ApiRoutes.scala`'s authenticated route tree alongside `DataSourceRoutes`/`SourceRoutes`.

## 3. helio-mcp

- [x] 3.1 Add `listConnectors()` to `helio-mcp/src/helioApi.ts` (`GET /api/connectors`, thin typed wrapper, add response type to `types.ts`).
- [x] 3.2 Register `list_connectors` tool in `helio-mcp/src/tools/read.ts` following the existing `guarded(() => api.xxx())` pattern.

## 4. Frontend

- [x] 4.1 Add a `listConnectors` service call (`frontend/src/features/sources/services/`) hitting `GET /api/connectors`.
- [x] 4.2 Update `SourceTypeToggle.tsx` to render buttons from the fetched registry (or a sensible loading/fallback state) instead of the hardcoded list, preserving exact order/labels for the 7 current kinds.
- [x] 4.3 Verify `AddSourceModal.tsx`'s usage of `SourceTypeToggle` still compiles/behaves identically (typed `SourceType` union may now derive from the registry response or stay as a literal union guarded by a runtime check — pick whichever keeps `AddSourceModal`'s existing per-kind branching untouched).

## 5. Tests

- [x] 5.1 Backend: `ConnectorRegistrySpec` — asserts `ConnectorRegistry.all.map(_.kind).toSet == DataSourceKind.All`, and both equal an independently-written literal 7-kind set (fails if a kind is added to one without the other).
- [x] 5.2 Backend: assert SQL/REST registry entries' `requiredFields` names match `SqlSourceConfigPayload`/`RestApiConfigPayload`'s required field names (explicit lists, not reflection).
- [x] 5.3 Backend: `GET /api/connectors` route test — 7 entries returned, `requiredFields` present, no secret values anywhere in the serialized response, 401 when unauthenticated.
- [x] 5.4 Backend: existing `DataSourceKind`/`parseKind` test suite passes unmodified.
- [x] 5.5 helio-mcp: `list_connectors` tool test — verifies pass-through of the registry payload.
- [x] 5.6 Frontend: `SourceTypeToggle` test — renders the same 7 buttons/order/labels as before for the current kinds.
- [x] 5.7 Run full gate chain (`sbt test`, `npm run lint`, `npm test`, `npm run build`) and confirm zero regressions.
