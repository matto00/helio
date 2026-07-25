## 1. Backend: shape abstraction models

- [x] 1.1 Create `backend/src/main/scala/com/helio/domain/shapes/` package.
- [x] 1.2 Define `ShapeStepExpansion(kind: String, config: JsObject)` (design.md Decision 1).
- [x] 1.3 Define `ShapeParamDescriptor(name, label, dataType: String, required: Boolean, description: String)`.
- [x] 1.4 Define `RowCountContract` sealed trait (`ExactlyOne`, `AtMostParam(paramName)`, `Unbounded`)
      and `OutputFieldContract(name, dataType: DataFieldType, nullable)` (design.md Decision 2; no
      `role` field — dropped in design-gate round 2, see design.md).
- [x] 1.5 Define `OutputContract(rowCount: RowCountContract, fields: Vector[OutputFieldContract], description: String)`.
- [x] 1.6 Define `PipelineShape` trait (`id`, `label`, `description`, `paramsSchema`, `outputContract`,
      `expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]]`) in `PipelineShape.scala`.
- [x] 1.7 Define `PipelineShape.Registry: Map[String, PipelineShape]` and `PipelineShape.shapeFor(id)`
      (design.md Decision 4), following `PipelineStep.companionFor`'s error-message shape.

## 2. Backend: reference shape

- [x] 2.1 Implement `PassthroughShape` (id `"passthrough"`, params `{fields: Vector[String]}` required
      non-empty, `expand` → one `ShapeStepExpansion("select", SelectConfig(fields) as JsObject)`,
      `outputContract = OutputContract(Unbounded, Vector.empty, "...")`) (design.md Decision 7).
- [x] 2.2 Register `PassthroughShape` in `PipelineShape.Registry`.

## 3. Backend: catalog endpoint

- [x] 3.1 Add `PipelineShapeCatalogEntry` + `PipelineShapeService.catalog(): Vector[PipelineShapeCatalogEntry]`
      in `backend/src/main/scala/com/helio/services/PipelineShapeService.scala` (design.md Decision 5).
- [x] 3.2 Add `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala` with
      Spray JSON formats for the catalog entry, `paramsSchema` descriptor, and `outputContract`
      (including the `rowCount` discriminated shape from spec.md).
- [x] 3.3 Add `backend/src/main/scala/com/helio/api/routes/PipelineShapeRoutes.scala` — thin HTTP shell
      for `GET /api/pipeline-shapes` (distinct top-level prefix, NOT nested under `pipelines` — avoids
      the `PipelineIdSegment` collision, design.md Decision 6), same structure as `ConnectorRoutes`.
- [x] 3.4 Mount `PipelineShapeRoutes` in `ApiRoutes.scala`'s authenticated top-level `concat` as its own
      entry (order relative to `PipelineRoutes` doesn't matter — distinct prefix, design.md Decision 6).

## 4. Contract docs

- [x] 4.1 Add `schemas/pipeline-shape-catalog.schema.json` (JSON Schema 2020-12) for the catalog
      response array, matching `PipelineShapeProtocol`'s wire shape.
- [x] 4.2 Confirm `openspec/changes/shape-abstraction-registry/specs/pipeline-shape-registry/spec.md`
      matches the shipped endpoint/model shape exactly (fix any drift found during implementation).

## 5. Tests

- [x] 5.1 `PipelineShapeSpec`: registry lookup succeeds for `"passthrough"` and fails with a
      descriptive error for an unknown id.
- [x] 5.2 `PassthroughShapeSpec`: `expand` with valid params returns the expected single-`select`
      `ShapeStepExpansion` list; `expand` with missing `fields` returns `Left`.
- [x] 5.3 Cross-check test: map the reference shape's expansion to `CreatePipelineStepRequest` and
      decode via `PipelineStepConfigCodec.decode`, asserting success (AC3 / spec.md "Expansion is
      valid against the existing step decode path").
- [x] 5.4 `PipelineShapeServiceSpec` or isolated route test: `PipelineShapeRoutes` returns 200 with the
      catalog (including `passthrough`) when authenticated. THEN, separately, a composition-level test
      that drives the request through the fully composed `ApiRoutes` route tree (not the isolated route
      object — mirrors `ApiRoutesSpec`'s integration-style tests) and asserts `GET /api/pipeline-shapes`
      returns 200 with the real catalog content, and 401 when unauthenticated — this is the test that
      would have caught the round-1 design-gate routing collision and must catch any future mounting
      regression (design.md Risks; skeptic-design-1.md change request 2).
- [x] 5.5 Run `sbt test` for the full backend suite and confirm no pre-existing pipeline/step test
      regressed (spec.md "Existing step CRUD is unaffected").
- [x] 5.6 `PipelineShapeProtocolSpec`: serialize ALL THREE `RowCountContract` variants (`ExactlyOne`,
      `AtMostParam("n")`, `Unbounded`) via the protocol's JSON writer and assert the exact wire shape
      for each — `{"kind": "exactly-one"}`, `{"kind": "at-most-param", "paramName": "n"}`,
      `{"kind": "unbounded"}` — not just the `Unbounded` case the `passthrough` reference shape happens
      to exercise end-to-end. This is a first-class task, not optional: the sealed trait only catches a
      missing-case *compile* error, not a wrong-JSON-*output* bug in a branch nothing else touches
      (design-gate round 4 finding, skeptic-design-4.md).
