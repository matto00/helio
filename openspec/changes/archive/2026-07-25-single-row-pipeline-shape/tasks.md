## 1. Backend

- [x] 1.1 Create `SingleRowShape.scala` in `backend/src/main/scala/com/helio/domain/shapes/` with
      `id = "single-row"`, `label`, `description`, `paramsSchema` (mode/measures/combinator/conditions
      descriptors, conditional-requirement notes in each description text per design.md Decision 1/3).
- [x] 1.2 Implement `expand(params: JsObject)`: decode `"mode"`, branch to aggregate-mode and
      filter-mode decoding, reusing `com.helio.domain.steps.Aggregation`/`FilterCondition` (design.md
      Decision 2). Validate `fn`/`operator`/`combinator`/non-empty arrays/non-empty strings/duplicate
      aliases per design.md Decision 3, returning `Left` with descriptive messages.
- [x] 1.3 Aggregate-mode success path: return one `ShapeStepExpansion(AggregateStep.Kind, AggregateConfig(groupBy = Vector.empty, aggregations = measures).toJson.asJsObject)`.
- [x] 1.4 Filter-mode success path: return `Vector(ShapeStepExpansion(FilterStep.Kind, FilterConfig(...).toJson.asJsObject), ShapeStepExpansion(LimitStep.Kind, LimitConfig(1).toJson.asJsObject))`.
- [x] 1.5 Set `outputContract = OutputContract(RowCountContract.ExactlyOne, fields = Vector.empty, description = ...)`.
- [x] 1.6 Add `SingleRowShape.id -> SingleRowShape` to `PipelineShape.Registry` in `PipelineShape.scala`.
- [x] 1.7 Fix `OutputContract.scala`'s stale doc comment (lines 5-9 claim `RowCountContract` is
      "non-`sealed`"; the declaration is already `sealed trait RowCountContract` — correct the full
      stale prose span, no code change).

## 2. Tests

- [x] 2.1 `SingleRowShapeSpec.scala` (mirrors `PassthroughShapeSpec.scala`): aggregate-mode success,
      filter-mode success, missing/unknown `mode`, unsupported `fn`, duplicate aliases, unsupported
      `operator`, invalid `combinator`, empty `measures`/`conditions` arrays.
- [x] 2.2 In the same spec (or a nested `"expansion"` block), the AC3-style cross-check: map each
      expansion to `CreatePipelineStepRequest(kind, config)` and decode via
      `PipelineStepConfigCodec.decode` — assert success for both modes.
- [x] 2.3 Extend `PipelineShapeSpec.scala` with the registry-parity test: independently-authored
      `Set("passthrough", "single-row")` vs. `PipelineShape.Registry.keySet`, plus a `shapeFor("single-row")`
      lookup assertion.
- [x] 2.4 Add end-to-end engine coverage (new spec file `SingleRowShapeEngineSpec.scala` under
      `backend/src/test/scala/com/helio/domain/`, following `InProcessPipelineEngineSpec`'s `makeStep`/
      `run` pattern): aggregate-mode expansion run through `InProcessPipelineEngine` over a multi-row
      source yields exactly one row with the declared measure aliases; filter-mode expansion run over a
      source where conditions match >1 row yields exactly one row (proving `limit 1` follows `filter`).
- [x] 2.5 Run `sbt test` for the full backend suite; confirm no pre-existing test regresses and no new
      Flyway migration was added.
