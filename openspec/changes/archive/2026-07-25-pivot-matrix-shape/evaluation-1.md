## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 4 ticket ACs addressed explicitly:
  - Catalog entry with index/column/values/agg params + output contract documenting the dynamic-columns
    caveat: `PivotMatrixShape.paramsSchema` + `outputContract` (PivotMatrixShape.scala:43-84), verified
    live via `PipelineShapeRoutesSpec` extension.
  - `expand(params)` yields optional-aggregate + pivot and a run produces the expected matrix:
    `buildExpansion` (PivotMatrixShape.scala:95-121), proven end-to-end by `PivotMatrixShapeEngineSpec`.
  - Tests: expansion → step list (`PivotMatrixShapeSpec`) and end-to-end crosstab
    (`PivotMatrixShapeEngineSpec`) both present.
  - Backward compatible / additive: confirmed no Flyway migration, no schema/openspec drift outside the
    delta spec (see Phase 2).
- No AC silently reinterpreted. Design decisions 1/2 (conditional aggregate+pivot, hardcoded pivot
  `agg="first"` after pre-aggregate, case handling) match the code exactly — verified against
  `PivotStep.scala` (case-sensitive `cfg.agg` match, no `.toLowerCase`) and `AggregateStep.scala`
  (lowercases `fn` internally, no `"first"` case) directly.
- All `tasks.md` items (1.1–4.1) match what's implemented; nothing marked done that isn't.
- No scope creep: diff touches exactly `PivotMatrixShape.scala` (new), one-line `PipelineShape.scala`
  registry addition, and the two designated extend-not-duplicate test files
  (`PipelineShapeSpec`/`PipelineShapeRoutesSpec`), plus new test files. No unrelated files touched.
- No regressions: full `sbt test` run (2022 tests) succeeds, 0 failures.
- No API contract/schema changes needed or made — `npm run check:schemas` clean, no `schemas/` diff.
- Planning artifacts (proposal/design/tasks) accurately reflect the final implementation; no drift
  found between design.md prose and the shipped code.

### Phase 2: Code Review — PASS
Issues: none.

- **CONTRIBUTING.md compliance**: no inline FQNs anywhere in the new/touched files (grepped for
  `com.helio.`, `spray.json.`, `java.util.`, `org.apache.pekko.` mid-body — zero hits outside
  import blocks). `check:scala-quality` reports "clean" (the 64 warnings are all pre-existing files,
  unrelated to this change, informational-only per the script's own policy). New file
  `PivotMatrixShape.scala` is 178 lines, well under the 250-line soft budget.
- **DRY**: registry/catalog test extension follows the established extend-don't-duplicate pattern
  exactly (one parity test, one HTTP catalog assertion, both extended in place — no parallel tests
  added).
- **Readable**: clear naming (`SupportedAggs` vs `AggregateStepSupportedAggs`), no magic values —
  every literal ("first", "string", step kinds) is either a named constant or traceable to the wrapped
  step's own contract.
- **Modular**: `expand` composed from small single-purpose validators
  (`validateIndex`/`validateColumn`/`validateValues`/`validateAgg`/`validateCollisions`) +
  `buildExpansion`; no over-engineering, no new abstractions beyond what siblings already established.
- **Type safety**: fully typed, no `Any`/`asInstanceOf` outside the existing `ShapeStepExpansion.config`
  JSON boundary shared with sibling shapes.
- **Security/validation**: all four params validated before any step config is built; the three
  collision checks (`column ∈ index`, `values ∈ index`, `values == column`) are present exactly as
  designed and independently verified against `AggregateStep.apply`'s `keyMap ++ aggMap` merge
  semantics by direct read of `AggregateStep.scala`.
- **Error handling**: `expand` returns `Left` with descriptive, collision-naming messages for every
  invalid-input path; no exceptions thrown from the pure `expand` path.
- **Tests meaningful**: `PivotMatrixShapeEngineSpec` genuinely exercises duplicate `(index, column)`
  pairs (two `east`/`Q1` rows, 30.0 + 20.0 → asserts `revenue_Q1 == 50.0`), which would catch a real
  regression in the pre-aggregate wiring, not just a happy-path smoke test. Case-insensitivity and
  casing-normalization are both explicitly tested (`"SUM"` preserves casing in `aggregate.fn`; `"FIRST"`
  normalizes to lowercase in `pivot.agg`), matching design.md Decision 2 precisely.
- **No dead code**: no unused imports, no leftover TODO/FIXME.
- **Behavior-preserving**: this is purely additive (one registry line + one new file); no existing
  behavior touched.
- **Case-sensitivity handling (reviewer focus item 1)**: confirmed by direct read of both step sources —
  `PivotStep.apply`'s `SupportedAggs.contains(cfg.agg)` and inner `cfg.agg match` are exact/case-sensitive
  (no `.toLowerCase` in `PivotStep.scala`), while `AggregateStep.apply` lowercases `fn` before matching
  (`AggregateStep.scala:85`). The shape code never feeds raw user casing into `pivot.agg` — it's always
  the hardcoded literal `"first"` in both branches (PivotMatrixShape.scala:112, :119) — exactly matching
  design.md Decision 2.
- **Migration/schema drift (reviewer focus item 6)**: no Flyway migration in the diff; `git diff` for
  `backend/src/main/resources/db/migration/` and `schemas/` is empty; main is still at V72 after
  `sbt test`'s Flyway log, matching the pre-brief's stated baseline.
- **Pre-commit bypass (reviewer focus item 7)**: independently re-ran `npm run check:openspec` (fails
  with exactly the claimed "complete (12/12) but not archived" message, nothing else),
  `npm run check:scala-quality` (clean), `npm run lint` (clean), `npm run format:check` (clean),
  `npm run check:schemas` (clean). The executor's stated bypass reason is accurate and not masking a
  real failure.

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**`
files changed (diff stat confirms zero matches against these trigger globs) — this is a backend-only,
additive domain-layer change with no route/wire surface. Dev servers were not started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None beyond what's already flagged as explicitly out-of-scope in design.md's Risks/Trade-offs section
  (the `fields = Vector.empty` epic-level open issue, deferred by design to the human).

### Fresh evidence gathered this cycle
- `sbt "testOnly com.helio.domain.shapes.PivotMatrixShapeSpec com.helio.domain.PivotMatrixShapeEngineSpec com.helio.domain.shapes.PipelineShapeSpec com.helio.api.routes.PipelineShapeRoutesSpec"` — 33/33 passed.
- `sbt test` (full backend suite) — 2022/2022 passed, 0 failed, 0 canceled.
- `npm run check:openspec` — fails only with the expected "not yet archived" hygiene message.
- `npm run check:scala-quality` — clean (0 violations; 64 pre-existing informational file-size warnings, none new).
- `npm run check:schemas` — in sync.
- `npm run lint` / `npm run format:check` — clean.
- Direct reads of `PivotStep.scala` and `AggregateStep.scala` to independently confirm the
  case-sensitivity and `keyMap ++ aggMap` collision claims in design.md, rather than trusting the
  executor's self-report.
