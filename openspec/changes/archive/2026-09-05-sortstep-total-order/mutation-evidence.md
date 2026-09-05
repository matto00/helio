# HEL-981 mutation-check evidence (tasks.md 2.9-2.12)

All three mutations were applied directly to `backend/src/main/scala/com/helio/domain/steps/SortStep.scala`,
run against the real, final `SortStepSpec.scala` (via `sbt "testOnly com.helio.domain.steps.SortStepSpec"`),
and then reverted (confirmed via diff against the pre-mutation file) before the next mutation was applied.
Guards 2.1/2.2 are contract guards (irreflexivity / antisymmetry) and are exempt from the discrimination
requirement per design.md; they are not expected to fail under any mutation below.

**Cycle 2 update (evaluation-1.md Change Request 1):** guard 2.6 originally asserted only
`sortedA.map(equivClass) shouldBe sortedB.map(equivClass)` — two runs of the *same* comparator
compared against each other, which is structurally incapable of discriminating between candidate
orderings (every candidate is deterministic, so both runs always move together). The evaluator's
independent mutation re-runs confirmed 2.6 passed under all three mutations. Fixed by additionally
pinning the expected equivalence-class sequence (`Seq(9, "9", 10, "n/a", "zzz", null).map(equivClass)`)
and asserting both `sortedA` and `sortedB` against it, not just against each other. The mutation
results below for 2.6 are re-run against this strengthened guard.

## Mutation A — `all-or-nothing` per column (tasks.md 2.9)

Applied at the `sortWith` call site (not the comparator): pre-scan `currentRows` for the sort key; if every
non-null value coerces to a finite double, compare pairs numerically, otherwise compare every pair via
`toString`.

Command: `sbt "testOnly com.helio.domain.steps.SortStepSpec"`

```
[info] SortStepSpec:
[info] SortStep.apply
[info] - should sorts numeric-looking String values numerically, not lexicographically (HEL-893)
[info] - should sorts numeric-looking String values descending, numerically
[info] - should is irreflexive over a mixed value set (HEL-981 2.1)
[info] - should is antisymmetric over all pairs of the mixed value set, permitting equivalence (HEL-981 2.2)
[info] - should is transitive over all triples of the mixed value set, in both directions (HEL-981 2.3)
[info] - should keeps the ticket's exact repro's numeric values in numeric order (HEL-981 2.4) *** FAILED ***
[info]   List(10, 9, "n/a") was not equal to List(9, 10, "n/a") (SortStepSpec.scala:148)
[info] - should reverses tiers when descending, with a null still last (HEL-981 2.5) *** FAILED ***
[info]   List("n/a", 9, 10, null) was not equal to List("n/a", 10, 9, null) (SortStepSpec.scala:154)
[info] - should produces the same sort-key equivalence-class sequence regardless of input order (HEL-981 2.6) *** FAILED ***
[info]   Vector(Right(Left(10.0)), Right(Left(9.0)), Right(Left(9.0)), Right(Right("n/a")), Right(Right("zzz")), Left("null")) was not equal to List(Right(Left(9.0)), Right(Left(9.0)), Right(Left(10.0)), Right(Right("n/a")), Right(Right("zzz")), Left("null")) (SortStepSpec.scala:171)
[info] - should sorts "NaN" and "Infinity" as non-coercible tier-2 values, not as numbers (HEL-981 2.7) *** FAILED ***
[info]   List("0aa", 5, "Infinity", "NaN", "n/a") was not equal to List(5, "0aa", "Infinity", "NaN", "n/a") (SortStepSpec.scala:190)
[info] Tests: succeeded 5, failed 4, canceled 0, ignored 0, pending 0
```

**Result: 2.4, 2.5, (post-strengthening) 2.6 and (post-strengthening) 2.7 fail, as expected.** The single
non-coercible `"n/a"` in the column flips the whole column to lexicographic order, so the numeric values
(`9`, `10`, `5`) lose their numeric ordering, and the pinned equivalence-class sequence in 2.6 and the
tier-discriminating `"0aa"` fixture in 2.7 no longer match. Reverted; confirmed via `diff` against the
pre-mutation file that the restore was exact.

## Mutation B — `numeric-tier-last` (tasks.md 2.10)

Applied inside `compareNonNullAsc`: swapped the two tie-break arms so a tier-1 (numeric) value sorts *after*
a tier-2 (non-coercible) value in `asc` (`(Some(_), None) => 1`, `(None, Some(_)) => -1`, i.e. exactly
reversed from the shipped code).

Command: `sbt "testOnly com.helio.domain.steps.SortStepSpec"`

```
[info] SortStepSpec:
[info] SortStep.apply
[info] - should sorts numeric-looking String values numerically, not lexicographically (HEL-893)
[info] - should sorts numeric-looking String values descending, numerically
[info] - should is irreflexive over a mixed value set (HEL-981 2.1)
[info] - should is antisymmetric over all pairs of the mixed value set, permitting equivalence (HEL-981 2.2)
[info] - should is transitive over all triples of the mixed value set, in both directions (HEL-981 2.3)
[info] - should keeps the ticket's exact repro's numeric values in numeric order (HEL-981 2.4) *** FAILED ***
[info]   List("n/a", 9, 10) was not equal to List(9, 10, "n/a") (SortStepSpec.scala:148)
[info] - should reverses tiers when descending, with a null still last (HEL-981 2.5) *** FAILED ***
[info]   List(10, 9, "n/a", null) was not equal to List("n/a", 10, 9, null) (SortStepSpec.scala:154)
[info] - should produces the same sort-key equivalence-class sequence regardless of input order (HEL-981 2.6) *** FAILED ***
[info]   Vector(Right(Right("n/a")), Right(Right("zzz")), Right(Left(9.0)), Right(Left(9.0)), Right(Left(10.0)), Left("null")) was not equal to List(Right(Left(9.0)), Right(Left(9.0)), Right(Left(10.0)), Right(Right("n/a")), Right(Right("zzz")), Left("null")) (SortStepSpec.scala:171)
[info] - should sorts "NaN" and "Infinity" as non-coercible tier-2 values, not as numbers (HEL-981 2.7) *** FAILED ***
[info]   List(5, "Infinity", "NaN", "0aa", "n/a") was not equal to List(5, "0aa", "Infinity", "NaN", "n/a") (SortStepSpec.scala:190)
[info] Tests: succeeded 5, failed 4, canceled 0, ignored 0, pending 0
```

**Result: 2.4, 2.5, (post-strengthening) 2.6 and (post-strengthening) 2.7 fail, as expected** (2.7's mixed
numeric/non-coercible fixture also flips tier order under this mutation, which is a valid extra
discrimination, not a contradiction of the task's prediction). Reverted; confirmed via `diff` against the
pre-mutation file that the restore was exact.

## Mutation C — pre-fix per-pair comparator (tasks.md 2.11)

Restored the original per-pair fallback inside the `sortWith` lambda: coerce both sides via
`PipelineRowJson.toDouble` (not the finite-only `finiteNumeric`) and compare numerically only when BOTH
sides coerce, else fall back to `toString` comparison for that pair only (the original defect: mode decided
per pair, not per column or per value).

Command: `sbt "testOnly com.helio.domain.steps.SortStepSpec"`

```
[info] SortStepSpec:
[info] SortStep.apply
[info] - should sorts numeric-looking String values numerically, not lexicographically (HEL-893)
[info] - should sorts numeric-looking String values descending, numerically
[info] - should is irreflexive over a mixed value set (HEL-981 2.1)
[info] - should is antisymmetric over all pairs of the mixed value set, permitting equivalence (HEL-981 2.2)
[info] - should is transitive over all triples of the mixed value set, in both directions (HEL-981 2.3) *** FAILED ***
[info]   x=1 y=NaN z=9 direction=asc (equivalence): false was not equal to true (SortStepSpec.scala:139)
[info] - should keeps the ticket's exact repro's numeric values in numeric order (HEL-981 2.4)
[info] - should reverses tiers when descending, with a null still last (HEL-981 2.5)
[info] - should produces the same sort-key equivalence-class sequence regardless of input order (HEL-981 2.6)
[info] - should sorts "NaN" and "Infinity" as non-coercible tier-2 values, not as numbers (HEL-981 2.7) *** FAILED ***
[info]   List("0aa", 5, "NaN", "Infinity", "n/a") was not equal to List(5, "0aa", "Infinity", "NaN", "n/a") (SortStepSpec.scala:190)
[info] Tests: succeeded 7, failed 2, canceled 0, ignored 0, pending 0
```

**Result: 2.3 (transitivity, specifically transitivity of equivalence over a triple involving `NaN`) fails,
as expected** — this is the ticket's actual defect (non-transitive relation). **2.4 STILL PASSES, exactly as
tasks.md 2.11 predicted**: every permutation of `{10, 9, "n/a"}` still lands on `9, 10, "n/a"` under this
comparator (its 3-element output sequence happens to survive because the defect is in the relation, not
in this particular sequence); fixture 2.4 was left unmodified, as instructed. 2.7 also fails under this
mutation (a real, additional discrimination on the `NaN`/`Infinity` scenario — the pre-fix comparator
coerces `"NaN"` via `toDoubleOption` and compares it as `NaN`, which is neither `<` nor `>` anything, so
`"NaN"` does not sort where the fixed comparator's tier-2 lexicographic rule puts it).

Reverted; confirmed via `diff` against the pre-mutation file that the restore was exact.

## Mutation D — drop the `.filter(_.isFinite)` tier-membership exclusion (final-gate skeptic, skeptic-final-1.md)

**Cycle 3 update.** Mutations A/B/C above only perturb tier *order* (which tier sorts first, or how a pair
compares within the pre-fix fallback); none perturbs tier *membership* (which values land in which tier).
The skeptic ran the missing mutation: replace `finiteNumeric`'s body with plain `PipelineRowJson.toDouble(v)`
(dropping `.filter(_.isFinite)`), so `NaN` and both infinities move into tier 1 instead of tier 2.

**Before strengthening, the entire suite (including 2.7) was green under this mutation** — 2.7's original
fixture `{5, "NaN", "Infinity", "n/a"}` is degenerate: `"Infinity" < "NaN" < "n/a"` lexicographically (tier-2
order) **and** `5 < Infinity < NaN` under `java.lang.Double.compare` (tier-1-with-NaN order), so both
tierings happen to produce the identical output sequence. The NaN/Infinity tier-membership rule — the
subtlest part of this whole change, and the one design.md's own Risks section calls out by name — was
therefore unpinned by any guard. 2.7 was strengthened (Change Request 1) by adding `"0aa"`, a non-coercible
string chosen to sort *before* `"Infinity"`/`"NaN"` lexicographically but *after* them under
`Double.compare`, so the two tierings now diverge on this fixture.

Command: `sbt "testOnly com.helio.domain.steps.SortStepSpec"`

```
[info] SortStepSpec:
[info] SortStep.apply
[info] - should sorts numeric-looking String values numerically, not lexicographically (HEL-893)
[info] - should sorts numeric-looking String values descending, numerically
[info] - should is irreflexive over a mixed value set (HEL-981 2.1)
[info] - should is antisymmetric over all pairs of the mixed value set, permitting equivalence (HEL-981 2.2)
[info] - should is transitive over all triples of the mixed value set, in both directions (HEL-981 2.3)
[info] - should keeps the ticket's exact repro's numeric values in numeric order (HEL-981 2.4)
[info] - should reverses tiers when descending, with a null still last (HEL-981 2.5)
[info] - should produces the same sort-key equivalence-class sequence regardless of input order (HEL-981 2.6)
[info] - should sorts "NaN" and "Infinity" as non-coercible tier-2 values, not as numbers (HEL-981 2.7) *** FAILED ***
[info]   List(5, "Infinity", "NaN", "0aa", "n/a") was not equal to List(5, "0aa", "Infinity", "NaN", "n/a") (SortStepSpec.scala:190)
[info] Tests: succeeded 8, failed 1, canceled 0, ignored 0, pending 0
```

**Result: (post-strengthening) 2.7 fails by name, as expected.** With `NaN`/`Infinity` in tier 1, `5`,
`Infinity`, `NaN` sort together numerically (`Double.compare` places `NaN` last), and `"0aa"`/`"n/a"` sort
lexicographically in tier 2 — giving `5, Infinity, NaN, 0aa, n/a`, which no longer matches the shipped
tiering's `5, 0aa, Infinity, NaN, n/a`. Reverted; confirmed via `diff` against the pre-mutation file that the
restore was exact. Re-ran Mutations A and B afterward against the strengthened suite to confirm no
regression: both still produce their previously-recorded 2.4/2.5/2.6 failures, plus 2.7 now also fails under
both (the strengthened fixture is more sensitive, which is an improvement, not a contradiction).

## Discrimination coverage (tasks.md 2.12)

| Guard | Mutation A | Mutation B | Mutation C | Mutation D |
| --- | --- | --- | --- | --- |
| 2.1 (irreflexivity) | pass (exempt) | pass (exempt) | pass (exempt) | pass (exempt) |
| 2.2 (antisymmetry) | pass (exempt) | pass (exempt) | pass (exempt) | pass (exempt) |
| 2.3 (transitivity) | pass | pass | **fails** | pass |
| 2.4 (ticket repro fixture) | **fails** | **fails** | pass (predicted) | pass |
| 2.5 (desc + null fixture) | **fails** | **fails** | pass | pass |
| 2.6 (order-independence + pinned equivalence-class sequence) | **fails** | **fails** | pass | pass |
| 2.7 (NaN/Infinity tier-2 fixture, `"0aa"`-strengthened) | **fails** | **fails** | **fails** | **fails** |

Every guard among 2.3-2.7 fails under at least one of the four mutations, so none needs strengthening per
the 2.12 rule. 2.7 is now the only guard that fails under all four — it is the guard responsible for pinning
both the tier-*order* rule (A/B/C) and the tier-*membership* rule (D), so this is expected, not suspicious.

2.6 was strengthened in cycle 2 (evaluation-1.md Change Request 1) by additionally pinning the expected
equivalence-class sequence (numeric tier, then non-coercible tier, then null), rather than only comparing
two runs of the same comparator to each other. That original cross-run-equality-only shape was
structurally incapable of discriminating any candidate ordering (every candidate is deterministic, so both
runs always move together identically) — confirmed passing under all three mutations before the fix. The
strengthened guard now fails under Mutation A (all-or-nothing) and Mutation B (numeric-tier-last), because
both change which tier a value lands in and therefore reorder the pinned expected sequence. It still passes
under Mutation C, which is correct and expected: Mutation C's defect is non-transitivity of the relation
(caught by 2.3), not a different final ordering of this specific fixture's equivalence classes — the
fixture contains no `NaN`/`Infinity` values, so Mutation C's specific breakage (a value that compares
neither `<` nor `>` anything) never manifests in this sequence. 2.6 passing under C is the same
"real discriminator, doesn't need to fire under every mutation" situation already documented for 2.4 under
Mutation C.
