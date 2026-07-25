- `backend/src/main/scala/com/helio/domain/shapes/PivotMatrixShape.scala` — new `pivot-matrix` shape:
  validates `index`/`column`/`values`/`agg`, rejects the `column ∈ index`/`values ∈ index`/
  `values == column` collisions, and expands to a conditional `aggregate` + `pivot` (reducer aggs) or
  `pivot` alone (`agg = "first"`), per design.md Decisions 1/2.
- `backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala` — registers `PivotMatrixShape`
  in `PipelineShape.Registry` under id `"pivot-matrix"`.
- `backend/src/test/scala/com/helio/domain/shapes/PivotMatrixShapeSpec.scala` — new unit tests for
  `PivotMatrixShape.expand`/`outputContract` (valid two-step/one-step expansions, case-insensitivity
  and casing normalization, missing/empty/duplicate params, unsupported `agg`, all three collision
  rejections, AC3 decode-path coverage).
- `backend/src/test/scala/com/helio/domain/PivotMatrixShapeEngineSpec.scala` — new end-to-end test
  running the real pipeline engine over a fixture with duplicate `(index, column)` pairs (`agg =
  "sum"`, proving pre-aggregate collapse) and a fixture with no duplicates (`agg = "first"`, proving
  `pivot` alone produces the correct crosstab).
- `backend/src/test/scala/com/helio/domain/shapes/PipelineShapeSpec.scala` — extended the
  registry-parity id set and lookup/equality assertions to include `"pivot-matrix"` (size 5).
- `backend/src/test/scala/com/helio/api/routes/PipelineShapeRoutesSpec.scala` — extended the
  named-shape catalog assertion to also check for a `"pivot-matrix"` entry with a non-empty
  `paramsSchema`.
