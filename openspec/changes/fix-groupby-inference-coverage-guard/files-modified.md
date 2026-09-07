# Files modified

- `backend/src/main/scala/com/helio/domain/steps/GroupByStep.scala` — extracted
  `GroupByStep.outputColumnName(cfg)` from the inline `outputCol` expression in `apply`, so
  runtime and analyze-time inference share one definition of the emitted aggregate column
  name (design.md Decision 1).
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — widened
  `inferOutputSchema` from object-`private` to `private[engine]` (task 3.0, with an in-source
  comment stating this is solely for the coverage guard); added `inferGroupBy` (group-key
  fields typed from the input schema by name, plus one aggregate column named via
  `GroupByStep.outputColumnName` and typed via `aggResultType` on a single lowercased
  `aggFunction`) and wired `case "groupby" => inferGroupBy(...)` into the dispatch, replacing
  the prior fall-through to `Unknown op: 'groupby'`.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — added
  AC1/AC2 `groupby` projection tests deriving their expectation from `GroupByStep.apply`'s
  actual emitted rows (not from the config), plus the primary-deliverable registry-vs-dispatch
  coverage guard (AC3): calls `inferOutputSchema` directly per registered kind with a fully
  valid config + compatible input schema, asserts `validationError` is `None`, and asserts an
  explicit (empty) exemption map is a subset of the registry.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` —
  removed the stale HEL-860 "unassertable" comment (AC5) and added a route-level test
  asserting a valid `groupby` step returns no `validationError` through the real route
  (`validateStepConfig` -> dispatch, end to end).

No migration — pure inference logic; no persisted or wire-shape changes.
