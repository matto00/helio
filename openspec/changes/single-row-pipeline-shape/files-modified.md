- `backend/src/main/scala/com/helio/domain/shapes/SingleRowShape.scala` — new. Registers the
  `single-row` shape: `expand(params)` decodes a `mode`-discriminated union (`"aggregate"` →
  one empty-`groupBy` `aggregate` step; `"filter"` → `filter` + `limit 1`), reusing
  `com.helio.domain.steps.Aggregation`/`FilterCondition` for item decoding (Try-wrapped per item,
  mirroring `AggregateConfig.decode`, so a malformed item returns `Left` instead of throwing).
  Validates `fn`/`operator`/`combinator`/non-empty arrays/non-empty strings/duplicate aliases.
  Declares `outputContract = OutputContract(RowCountContract.ExactlyOne, Vector.empty, ...)`.
- `backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala` — added
  `SingleRowShape.id -> SingleRowShape` to `Registry`.
- `backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala` — fixed the stale doc
  comment (was lines 5-9, claimed `RowCountContract` is "non-`sealed`"; the declaration is already
  `sealed trait RowCountContract` — corrected the full stale prose span, no code change).
- `backend/src/test/scala/com/helio/domain/shapes/SingleRowShapeSpec.scala` — new. Mirrors
  `PassthroughShapeSpec.scala`: aggregate-mode success/failure paths (missing/unknown mode,
  unsupported `fn`, malformed-type item via `Try`-wrap, duplicate aliases, empty field/alias),
  filter-mode success/failure paths (unsupported `operator`, invalid `combinator`, empty
  `conditions`/`field`), `outputContract` assertion, and the AC3 `PipelineStepConfigCodec.decode`
  cross-check for both modes.
- `backend/src/test/scala/com/helio/domain/shapes/PipelineShapeSpec.scala` — extended with the
  registry-parity drift test (independently-authored `Set("passthrough", "single-row")` vs.
  `PipelineShape.Registry.keySet`, mirroring `ConnectorRegistrySpec`) and a `shapeFor("single-row")`
  lookup assertion; updated the pre-existing "Registry contains exactly" assertion for the new
  2-shape registry.
- `backend/src/test/scala/com/helio/domain/SingleRowShapeEngineSpec.scala` — new. End-to-end
  coverage proving both expansion modes execute through `InProcessPipelineEngine` to exactly one
  row: aggregate-mode over a multi-row source yields one row with the declared measure aliases;
  filter-mode over a source where conditions match >1 row yields exactly one row (proving `limit 1`
  runs after `filter`).
