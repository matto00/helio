- `backend/src/main/scala/com/helio/domain/shapes/TopNShape.scala` — new `top-n` shape: validates
  `measure`/`direction`/`n`/`ties`, expands to `sort` + `limit` (design.md Decision 1/2/3); declares
  `outputContract = AtMostParam("n")`.
- `backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala` — registers
  `TopNShape.id -> TopNShape` in `Registry`.
- `backend/src/main/scala/com/helio/domain/shapes/SingleRowShape.scala` — one-line fix:
  `validateMeasures` now checks `SupportedFns.contains(m.fn.toLowerCase)` instead of
  `SupportedFns.contains(m.fn)`, matching `AggregateStep.apply`'s own case-insensitive runtime
  matching (design.md Decision 4).
- `backend/src/test/scala/com/helio/domain/shapes/TopNShapeSpec.scala` — new: `expand` validation
  coverage (valid params, case-insensitive direction, missing/empty measure, missing/non-positive
  n, unknown direction, unsupported ties value), `outputContract` assertion, AC3 decode-path
  cross-check.
- `backend/src/test/scala/com/helio/domain/TopNShapeEngineSpec.scala` — new: end-to-end engine
  coverage — top-N and bottom-N runs, plus a dedicated tie-break case asserting the earlier-input
  row is kept at the N/N+1 boundary (design.md Decision 3).
- `backend/src/test/scala/com/helio/domain/shapes/PipelineShapeSpec.scala` — extended the
  registry-parity test (`Set("passthrough", "single-row", "top-n")`) and added a
  `shapeFor("top-n")` lookup assertion.
- `backend/src/test/scala/com/helio/domain/shapes/SingleRowShapeSpec.scala` — added a case proving
  an uppercase `"fn": "SUM"` now returns `Right` (HEL-394 case-insensitivity fix).
- `backend/src/test/scala/com/helio/api/routes/PipelineShapeRoutesSpec.scala` — added the
  named-shape catalog HTTP assertion: `GET /pipeline-shapes` contains `id = "single-row"` and
  `id = "top-n"` entries, each with a non-empty `paramsSchema` (HEL-393 review follow-up #2).

Note: `PipelineShapeProtocolSpec`'s existing `AtMostParam("n")` wire round-trip test (added by
HEL-391) already covers task 2.3's wire-serialization requirement — verified it passes and did not
duplicate it.

No Flyway migration added (`git status backend/src/main/resources/db/migration/` is clean) — the
shape registry is code-level, consistent with `ConnectorRegistry`.
