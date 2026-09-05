# HEL-981: SortStep's partial-coercion fallback is not a total order and can produce unstable orderings

## Description

Found while validating HEL-893's premise (which claimed, incorrectly, that sorting a string column is lexicographic). `SortStep` is actually value-driven and coerces numeric-looking strings — but the way it falls back is unsound.

### The defect

`SortStep.apply` (`backend/src/main/scala/com/helio/domain/steps/SortStep.scala:76-83`) decides numeric-vs-lexicographic **per comparison pair**, not per column:

```scala
val xn = PipelineRowJson.toDouble(x)
val yn = PipelineRowJson.toDouble(y)
(xn, yn) match {
  case (Some(xd), Some(yd)) => if (desc) xd > yd else xd < yd
  case _ =>
    val xs = x.toString
    val ys = y.toString
    if (desc) xs > ys else xs < ys
}
```

For a column that is only partly numeric — e.g. `10`, `9`, `"n/a"` — the comparator uses numeric ordering for some pairs and lexicographic ordering for others. That relation is **not transitive**, so it is not a total order.

`sortWith` requires a total order. Given a non-transitive comparator, the resulting sequence is not merely "sorted oddly" — it is unspecified, can differ with input order, and in the general case a sort can misbehave badly. A user sees a silently wrong ordering with no error.

### Why it matters now

HEL-893 makes CSV columns report `string` rather than a parsed numeric type, so partly-numeric CSV columns are a more visible, more likely shape than before. HEL-893 added a regression guard for the fully-numeric-looking-string case (`backend/src/test/scala/com/helio/domain/steps/SortStepSpec.scala`), but deliberately did not absorb this defect.

### Repro

Sort a column whose values are `10`, `9`, and `n/a`. `10` vs `9` compares numerically (9 < 10); `10` vs `n/a` and `9` vs `n/a` compare lexicographically (`"10" < "n/a"`, `"9" < "n/a"`). The three pairwise results cannot be realised by any single ordering of the elements.

### Suggested resolution

Decide the comparison mode **once per column** rather than per pair — e.g. scan the column and use numeric ordering only if every non-null value coerces, otherwise lexicographic throughout. That yields a genuine total order in both cases. Where the mode is mixed, decide deliberately where non-coercible values sort (alongside the existing nulls-last behaviour) rather than leaving it emergent.

Pin it with a test whose input contains both numeric and non-numeric values and which asserts a specific, stable ordering.

## Acceptance Criteria

1. `SortStep`'s comparator is a genuine strict weak ordering (what `sortWith` requires) for every column shape: all-numeric, all-non-numeric, mixed numeric/non-numeric, and columns containing nulls. Irreflexivity, antisymmetry, transitivity and transitivity of equivalence hold. Trichotomy does not — `9` and `"9"` compare equivalent — and must not be asserted.
2. The ordering semantics for mixed and uncoercible values are **explicitly chosen and documented** (in `design.md` and in the code's own scaladoc), not emergent from the implementation.
3. Existing behaviour is preserved where it was already well-defined: all-numeric-looking String columns still sort numerically (HEL-893's two guards must still pass, unmodified), and nulls still sort last in both `asc` and `desc`.
4. Multi-key sorts remain stable in the primary/secondary sense the current `foldRight` provides.
5. The change is pinned by tests that prove the comparator's contract: a property-style check (irreflexivity / antisymmetry / transitivity, permitting equivalence) over a mixed-type value set, plus at least one fixture whose correct output ordering differs from its input ordering. The discriminating guards must be mutation-checked against BOTH rejected alternatives (`all-or-nothing`, `numeric-tier-last`) and the pre-fix comparator — not merely against the pre-fix comparator — with the transcripts recorded as evidence. The irreflexivity and antisymmetry guards are exempt from the discrimination requirement: they hold under every candidate ordering and are contract guards, not discriminators.
6. No database migration is introduced (the shared dev Postgres has concurrent runs).

## Constraints

- No production database or deploy access.
- The dev Postgres is shared with concurrent HEL-980 / HEL-975 runs. If a migration turns out to be needed, escalate rather than writing one.
