## Backend — new files

- `backend/src/main/scala/com/helio/domain/shapes/ShapeStepExpansion.scala` — domain-level
  `ShapeStepExpansion(kind, config)` mirroring `CreatePipelineStepRequest`'s two-field shape
  without importing `com.helio.api.protocols` (design.md Decision 1).
- `backend/src/main/scala/com/helio/domain/shapes/ShapeParamDescriptor.scala` — descriptive
  metadata for one `expand` param (name/label/dataType/required/description).
- `backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala` — `RowCountContract`
  (`ExactlyOne`/`AtMostParam(paramName)`/`Unbounded`), `OutputFieldContract` (3 fields, no `role`
  per design-gate round 2), and `OutputContract`.
- `backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala` — the `PipelineShape` trait
  (`id`, `label`, `description`, `paramsSchema`, `outputContract`, `expand`) plus
  `PipelineShape.Registry` / `shapeFor(id)`.
- `backend/src/main/scala/com/helio/domain/shapes/PassthroughShape.scala` — the trivial reference
  shape: `fields: Vector[String]` (required, non-empty) → one `select` `ShapeStepExpansion`;
  `outputContract = Unbounded` with an empty `fields` list.
- `backend/src/main/scala/com/helio/services/PipelineShapeService.scala` — `PipelineShapeCatalogEntry`
  + `PipelineShapeService.catalog()`, projecting every registered shape (sorted by `id` for a stable
  response order).
- `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala` — Spray JSON formats
  for the catalog wire shape: `OutputFieldContractResponse` (stringifies `DataFieldType`),
  `OutputContractResponse`, `PipelineShapeCatalogEntryResponse`, and a custom discriminated-union
  `RootJsonFormat[RowCountContract]` (`{"kind": "exactly-one" | "at-most-param" | "unbounded",
  paramName?}`).
- `backend/src/main/scala/com/helio/api/routes/PipelineShapeRoutes.scala` — thin HTTP shell for
  `GET /api/pipeline-shapes`, mounted as a distinct top-level prefix (design.md Decision 6).

## Backend — modified files

- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — constructs `PipelineShapeService`
  (dependency-free) and mounts `PipelineShapeRoutes` in the authenticated top-level `concat`.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes in `PipelineShapeProtocol`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports
  `OutputFieldContractResponse`/`OutputContractResponse`/`PipelineShapeCatalogEntryResponse` into
  `com.helio.api` (existing per-domain re-export convention).

## Backend — new tests

- `backend/src/test/scala/com/helio/domain/shapes/PipelineShapeSpec.scala` — registry lookup
  (success + descriptive-error-on-unknown-id) and `Registry` contents (spec.md task 5.1).
- `backend/src/test/scala/com/helio/domain/shapes/PassthroughShapeSpec.scala` — `expand` valid/
  missing/empty/non-string-entry params, plus the AC3 cross-check that maps the expansion through
  `CreatePipelineStepRequest` → `PipelineStepConfigCodec.decode` (spec.md tasks 5.2/5.3).
- `backend/src/test/scala/com/helio/api/routes/PipelineShapeRoutesSpec.scala` — isolated route
  test (mirrors `ConnectorRoutesSpec`): 200 with the passthrough entry, paramsSchema/outputContract
  present (spec.md task 5.4, first half).
- `backend/src/test/scala/com/helio/api/protocols/PipelineShapeProtocolSpec.scala` — serializes all
  three `RowCountContract` variants through the protocol's JSON writer and asserts the exact wire
  shape for each, plus a round-trip check (spec.md task 5.6, explicitly non-optional per the
  ticket brief).

## Backend — modified tests

- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — added the composition-level
  coverage task 5.4 calls for: `GET /api/pipeline-shapes` through the fully composed `ApiRoutes`
  route tree returns 401 unauthenticated and 200 with the real catalog content when authenticated
  (the test that would have caught the round-1 design-gate routing collision).

## Contract docs

- `schemas/pipeline-shape-catalog.schema.json` — JSON Schema 2020-12 for one
  `PipelineShapeCatalogEntryResponse` entry (the `GET /api/pipeline-shapes` response body is an
  array of this shape). Verified against `PipelineShapeProtocol` via `npm run check:schemas`.
- `openspec/changes/shape-abstraction-registry/tasks.md` — all 21 tasks checked off.
- `openspec/changes/shape-abstraction-registry/specs/pipeline-shape-registry/spec.md` — reviewed
  against the shipped implementation (task 4.2); no drift found, no edits needed.
