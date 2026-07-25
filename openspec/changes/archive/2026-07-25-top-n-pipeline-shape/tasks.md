## 1. Backend

- [x] 1.1 Create `TopNShape.scala` in `backend/src/main/scala/com/helio/domain/shapes/` with
      `id = "top-n"`, `label`, `description`, `paramsSchema` (measure/direction/n/ties
      descriptors, per design.md Decision 1/2).
- [x] 1.2 Implement `expand(params: JsObject)`: validate `measure` (non-empty string), `direction`
      (`"asc"`/`"desc"` case-insensitive), `n` (positive `Int`), `ties` (optional, defaults
      `"strict"`, any other value → `Left` naming the `window`-op deferral) per design.md
      Decision 2/3.
- [x] 1.3 Success path: return `Vector(ShapeStepExpansion(SortStep.Kind, SortConfig(Vector(SortKey(measure, direction))).toJson.asJsObject), ShapeStepExpansion(LimitStep.Kind, LimitConfig(n).toJson.asJsObject))`.
- [x] 1.4 Set `outputContract = OutputContract(RowCountContract.AtMostParam("n"), fields = Vector.empty, description = ...)`.
- [x] 1.5 Add `TopNShape.id -> TopNShape` to `PipelineShape.Registry` in `PipelineShape.scala`.
- [x] 1.6 Fix `SingleRowShape.scala`'s `expandAggregate`/`validateMeasures` to check
      `SupportedFns.contains(m.fn.toLowerCase)` instead of `SupportedFns.contains(m.fn)`
      (design.md Decision 4) — leave `fn` on the wire/config unchanged (original casing preserved).
- [x] 1.7 Add a named-shape catalog assertion to `PipelineShapeRoutesSpec.scala`: `GET
      /pipeline-shapes` response contains entries with `id = "single-row"` and `id = "top-n"`,
      each with non-empty `paramsSchema` (design.md, spec.md "GET /api/pipeline-shapes returns
      the shape catalog").

## 2. Tests

- [x] 2.1 `TopNShapeSpec.scala` (mirrors `SingleRowShapeSpec.scala`): valid params success,
      case-insensitive `direction`, missing/empty `measure`, missing/non-positive `n`, unknown
      `direction`, unsupported `ties` value with deferral message in the error text.
- [x] 2.2 In the same spec, the AC3-style cross-check: map each expansion to
      `CreatePipelineStepRequest(kind, config)` and decode via `PipelineStepConfigCodec.decode` —
      assert success.
- [x] 2.3 Add an `outputContract` test: `rowCount shouldBe RowCountContract.AtMostParam("n")`,
      `fields shouldBe empty` — first real (non-`single-row`) exercise of `AtMostParam`'s wire
      serialization; add a matching round-trip test in `PipelineShapeProtocol`-adjacent coverage
      (or extend an existing wire-format spec) asserting
      `{"kind":"at-most-param","paramName":"n"}` serializes/deserializes correctly.
      (The `AtMostParam("n")` wire round-trip already exists in `PipelineShapeProtocolSpec`, added
      by HEL-391 in anticipation of this exact case — verified it covers write, and read-after-write
      round-trip; no duplicate added.)
- [x] 2.4 Extend `PipelineShapeSpec.scala`'s registry-parity test: independently-authored
      `Set("passthrough", "single-row", "top-n")` vs. `PipelineShape.Registry.keySet`, plus a
      `shapeFor("top-n")` lookup assertion.
- [x] 2.5 Add end-to-end engine coverage (new spec file `TopNShapeEngineSpec.scala` under
      `backend/src/test/scala/com/helio/domain/`, following `SingleRowShapeEngineSpec`'s
      `makeStep`/`run` pattern): a 10-row source with `n = 3` yields exactly 3 rows sorted
      correctly by `measure`/`direction`; a dedicated tie-break case (two rows tied at the N/N+1
      boundary) asserts the earlier-input row is kept (design.md Decision 3 / spec.md "top-n ties
      are broken deterministically by original input order").
- [x] 2.6 Add a `SingleRowShapeSpec.scala` case: `{"mode": "aggregate", "measures": [{"fn":
      "SUM", ...}]}` (uppercase `fn`) now returns `Right` (design.md Decision 4).
- [x] 2.7 Run `sbt test` for the full backend suite; confirm no pre-existing test regresses and no
      new Flyway migration was added.

## 3. Follow-up

- [ ] 3.1 File a HEL-337 spinoff Linear ticket for per-group (partitioned) top-N and the
      `keep-ties`/dense ties variant (both need the `window` op + a rank-based filter recipe;
      design.md Decision 5) — orchestrator files this post-delivery, not a code task.
