## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Central decision (pre-aggregate emitted for every `agg` except `"first"`)** — verified against
   `backend/src/main/scala/com/helio/domain/steps/PivotStep.scala:74` (`SupportedAggs = Vector("sum",
   "count", "avg", "min", "max", "first")`, matched at line 104 `cfg.agg match { ... }` with no
   `.toLowerCase` call anywhere in `PivotStep.apply`) and
   `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala:85` (`val fn = agg.fn.toLowerCase`)
   / lines 88-99 (`match` arms `sum`/`avg`/`min`/`max`/`count`, `case other => throw
   IllegalArgumentException(...)` — no `"first"` arm exists). The design's paraphrase in design.md
   Decision 1 and the delta spec's requirement text are exact matches to this ground truth, not loose
   restatements.

2. **`RowCountContract.Unbounded` justification** — read `OutputContract.scala:12-16` (doc comments for
   `ExactlyOne`/`AtMostParam`/`Unbounded`) and `TopNShape.scala:62-66` /
   `TimeSeriesShape.scala:76-82` for contrast. Design.md Decision 3 reasons independently: `index` is a
   field-name array (not a numeric bound, unlike `top-n`'s literal `"n"`), and actual row count is the
   distinct-index-tuple cardinality in the source — unknowable at `expand`-time. This is a genuine
   per-shape argument, not a copy-paste of `time-series`'s choice (it explicitly contrasts against
   `single-row`'s `ExactlyOne` and `top-n`'s `AtMostParam` before concluding `Unbounded` is independently
   correct here).

3. **Collision-hazard grounding** — verified against `AggregateStep.scala:78-102`: `groupByFields =
   cfg.groupBy.map(_.name)`, `keyMap = groupByFields.zip(keyValues).toMap`, `aggMap =
   aggregations.map{...}.toMap` keyed by `alias`, merged via `keyMap ++ aggMap` (right-biased, silent
   overwrite). Design.md Decision 4 / spec.md correctly derive: pre-aggregate `groupBy = index :+
   column`, single aggregation `alias = values`; if `values` collides with any `index` field or with
   `column` (both `keyMap` keys), the aggregation result silently clobbers a groupBy key. The additional
   `column ∈ index` rejection is correctly characterized as a *different* hazard class (self-referential
   pivot spec, not a `keyMap ++ aggMap` overwrite) — the design doesn't conflate the two.

4. **Case-sensitivity completeness** — traced both branches: pre-aggregate branch writes `pivot.agg =
   "first"` as a shape-owned literal, never derived from user casing; no-pre-aggregate branch validates
   `agg` case-insensitively against `"first"` then writes the canonical lowercase `"first"` literal, not
   the caller's casing. `AggregateStep`'s `fn` field preserves original user casing (correct, since
   `AggregateStep.scala:85` lowercases internally at runtime). No path exists where raw user casing
   reaches `PivotConfig.agg`, the one case-sensitive destination (`PivotStep.scala:104`, no
   `.toLowerCase`). Matches `TimeSeriesShape.scala:114-117`'s established pattern for the analogous
   `DateBucketStep` case-sensitivity handling.

5. **Structural violations** — none found. `grep -rn "com.helio.api.protocols"
   backend/src/main/scala/com/helio/domain/shapes/` only matches a docstring comment in
   `ShapeStepExpansion.scala:6,9` explaining *why* the type mirrors but doesn't import the API DTO — no
   actual import. Latest migration on disk is `V72__add_lookup_op.sql`; proposal.md:44 and design.md:10
   both explicitly state no migration, and neither artifact implies one. `OutputContract.scala`'s shape
   (3-field case class) is not touched by any decision in design.md.

6. **`fields = Vector.empty` precedent** — design.md Non-Goals (lines 40-43) and Decision explicitly
   defer to the epic-level precedent rather than re-litigating `OutputContract`, consistent with
   `OutputContract.scala:26-31`'s doc comment about the dropped `role` field and every sibling
   (`SingleRowShape`/`TopNShape`/`TimeSeriesShape`, all read) declaring `fields = Vector.empty`.

7. **Delta spec vs. design consistency + registry-parity/catalog MODIFIED requirements** — read
   `backend/src/test/scala/com/helio/domain/shapes/PipelineShapeSpec.scala:16` (current
   `expectedIds = Set("passthrough", "single-row", "top-n", "time-series")`, `Registry should have size
   4` at line 58) and `backend/src/test/scala/com/helio/api/routes/PipelineShapeRoutesSpec.scala:44-54`
   (named-entry assertions for `single-row`/`top-n`/`time-series`). The delta spec's MODIFIED
   requirements (spec.md lines 176-180, 217-222) correctly extend these existing size-4/three-named-shape
   assertions to size-5/four-named-shape, matching the "extend, don't duplicate" precedent explicitly —
   confirmed there is exactly one `PipelineShapeSpec.scala` and one `PipelineShapeRoutesSpec.scala` in
   the tree (no parallel test files). ADDED requirements in spec.md (expand validation, output contract,
   step-decode/end-to-end execution) are a faithful, non-contradictory restatement of design.md's five
   decisions — no drift between the two documents.

Also read `PassthroughShape`/`PipelineShape.scala`/`ShapeStepExpansion.scala`/`ShapeParamDescriptor.scala`
for the shared abstraction contract, and `TopNShape.scala` for a second sibling-convention comparison
point. All consistent.

### Minor observation (non-blocking)

Design.md Decision 5's framing — "validate `agg` against `PivotStep`'s six supported values... since
that's the step every `agg` value must ultimately be valid against" — is rhetorically slightly loose:
`PivotConfig.agg` in this shape's expansion is *never* actually set to a raw `sum`/`avg`/`min`/`max`/
`count` value (it's always the hardcoded `"first"` literal in both branches); it's `AggregateConfig`'s
`fn` that receives the user's reducer value. The validation-against-PivotStep's-six-value-set is still
the *correct* choice (it's exactly the union of what `AggregateStep` accepts plus `"first"`, and routes
every accepted value to a step that can execute it), just imprecisely justified. This doesn't change any
required revision — it's a phrasing nit in a design doc, not a code or spec defect.

### Verdict: CONFIRM

No placeholders, no internal contradictions between proposal/design/spec/tasks, no ambiguity a competent
implementer could misread, no scope drift beyond the ticket's stated params, and no structural violations
(no new op, no migration, no `OutputContract` redesign, no layering breach). All central technical claims
about `PivotStep`/`AggregateStep` behavior were independently verified against the actual step source and
are accurate, not paraphrased loosely. The design is sound to implement as written.

### Non-blocking notes

- The Decision 5 phrasing nit above — optional polish for the implementer's docstring, not a required
  revision.
