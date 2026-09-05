## Context

See `proposal.md` — Why. Current state: `SortStep.apply` (`backend/src/main/scala/com/helio/domain/steps/
SortStep.scala:60-88`) folds right over `cfg.sortBy`, calling `currentRows.sortWith` once per key. The
comparator handles nulls first (`case (None, _) => false; case (_, None) => true`, lines 73-74) and then
calls `PipelineRowJson.toDouble` on **both** sides per comparison, taking a numeric branch only when both
coerce and falling through to `x.toString`/`y.toString` otherwise (lines 76-83). `toDouble`
(`backend/src/main/scala/com/helio/domain/engine/PipelineRowJson.scala:69-78`) accepts `Int`/`Long`/`Float`/`Double`/`BigDecimal` and `String` via
`toDoubleOption`; everything else is `None`.

Constraints: `sortWith` requires a strict weak ordering. No migration is permitted this run — the dev
Postgres is shared with live HEL-980 / HEL-975 runs. `PipelineRowJson.toDouble` is used by other steps and
is not to be modified.

## Goals / Non-Goals

Goals beyond the proposal's scope statement: keep the fix inside the comparator so the `foldRight`
multi-key structure, its stability, and the existing null handling are untouched; keep the comparator
allocation-free per comparison beyond what `toDouble` already costs.

Non-goals beyond the proposal's: no per-column pre-scan pass (see Decision 2), and no attempt to make
`Double.NaN` a meaningful sort position (see Risks).

## Decisions

**D1 — Three-tier ordering: numbers → non-coercible → nulls. (Chosen: `numeric-tier-first`.)**
A value's tier is a function of the value alone, so the relation is transitive by construction: tier
comparison dominates, and within a tier a single consistent comparison (finite `Double`, or `String`)
applies. Precisely, this is a **strict weak ordering**, not a strict total order: `9` and `"9"` are distinct
values that compare equivalent, so trichotomy does not hold. A strict weak ordering is exactly what
`sortWith` requires, and the properties the tests assert (irreflexivity, antisymmetry, transitivity, and
transitivity of equivalence) are the right ones either way — but the artifacts must not claim trichotomy,
or a test written to that claim would assert something false.

_Alternatives considered and rejected_ (this list is normative — it is reproduced in `SortStep`'s scaladoc
so a future reader does not "simplify" the tiering back into a branch that reintroduces the defect):

- **all-or-nothing per column** — pre-scan the column; use numeric ordering only if every non-null value
  coerces, otherwise lexicographic throughout. This is the ticket's first suggested wording and it does
  produce a total order. Rejected because it degrades with a cliff: a single `"n/a"` cell in a
  10,000-row numeric CSV column flips the entire column to lexicographic, so `100` sorts before `9` for
  every other row. HEL-893 made exactly this column shape common, so the cliff would be hit often.
- **numeric-tier-last** — same tiering, but non-coercible values lead in `asc`. Rejected as the weaker
  default: the numeric values are the ones a user sorting a numeric column is looking at, so burying them
  behind an arbitrary count of junk rows is the less useful arrangement.

This decision was escalated rather than taken silently, because both rejected alternatives also close the
stated defect — so choosing between them is a product call about user-visible ordering, not an
implementation detail. Answer recorded: `numeric-tier-first`.

**D2 — Decide the tier per value, not per column.** The ticket suggests scanning the column to pick a mode.
That is unnecessary under D1: because the tier is derived from the value itself, per-value classification is
already transitive, and it avoids an extra O(n) pass plus the question of what a "column" means when
`sortWith` only ever sees two rows. It also keeps the fix local to the comparator lambda.

**D3 — `desc` reverses tier order as well as within-tier order; nulls stay last regardless.** The
rationale is uniformity of the *non-null* portion: reversing within tiers but not between them would leave
`desc` agreeing with `asc` on the tier axis while disagreeing on every within-tier comparison, which is
harder to explain and to test than "reverse the non-null ordering wholesale". Note this does not make `desc`
the exact reverse of `asc` — the null-last exemption already prevents that — so the argument is about the
non-null portion only. Nulls are exempted because null-last in both directions is existing shipped behaviour
(`pipeline-sort-op` spec, "Null values sort last") and is out of scope to change.

**D4 — Cross-type rule made explicit.** D1 commits the codebase to **numbers before strings** as a
cross-type ordering rule, which is not stated anywhere else in the codebase today. This is a real cost of
the choice, recorded here deliberately rather than left implicit: a future cross-type ordering elsewhere
(e.g. a comparison op, or a mixed-type aggregate) should either follow this rule or explicitly say why it
differs. Nothing currently forces consistency.

**D4a — Output determinism is "up to equivalence", and the artifacts must say so.** Because `9` and `"9"`
compare equivalent and `sortWith` is stable, two different input permutations of a multiset containing both
produce *different output value sequences*. An unqualified "sorting is input-order independent" claim is
therefore false. What actually holds, and what the spec now states, is: the *relation* is input-order
independent, and the output is determined uniquely **up to the order of equivalent values**. Any
input-order-independence guard must compare sort-key equivalence classes, not raw value sequences, whenever
its fixture contains cross-type equal values.

**D5 — Test strategy: prove the contract, not one sequence.** A hand-picked expected sequence can hold while
the relation is still non-transitive on a triple that was not picked, so the primary guard is a
property-style check over a mixed value set (numbers, numeric-looking strings, non-coercible strings, nulls,
and duplicates of each): irreflexivity, antisymmetry, and transitivity over all triples of that set, in both
directions. Fixture guards supplement it, and each is chosen so its correct output ordering **differs from
its input ordering** — otherwise it could pass by luck of insertion order.

**D6 — Mutation-check against the rejected alternatives, not only against the pre-fix code.** HEL-893's two
existing guards pass unmodified under `numeric-tier-first`, `all-or-nothing` **and** `numeric-tier-last`
(both their fixtures are all-numeric-looking-string columns, so every value is tier 1 and no non-coercible
value exists to trigger the all-or-nothing cliff), so a green suite proves nothing about which semantics
actually shipped. The *discriminating* guards must therefore be demonstrated to fail under each rejected
alternative, and that demonstration recorded as evidence. This is the single most important constraint on
this change.

Two carve-outs keep this rule honest rather than self-contradictory:

- **The contract guards do not discriminate, and must not be "strengthened" to.** Irreflexivity and
  antisymmetry hold under `numeric-tier-first`, both rejected alternatives, **and** the pre-fix per-pair
  comparator. They are required by AC5 and are the correct guards for the contract; they simply are not
  discriminators. The discrimination requirement applies to the transitivity and fixture guards
  (tasks 2.3-2.6), not to 2.1/2.2.
- **`all-or-nothing` is not a comparator swap.** It is a per-*column* mode needing an O(n) pre-scan (that is
  D2's whole point), so there is no pairwise comparator that implements it. Mutating it as a per-pair
  fallback would just re-create the pre-fix comparator, collapsing two distinct experiments into one. The
  mutation must be performed at the `sortWith` **call site**: pre-scan the rows for the key, and if any
  non-null value fails to coerce, compare every pair with `toString`.

## Risks / Trade-offs

- **A future reader collapses the tiering back to an all-or-nothing branch** → the rejected alternatives and
  their reasons live in the scaladoc at the point of change (D1), not only in this archived design doc.
- **A cell that only *looks* numeric may coerce to `NaN`/`Infinity`** — `"NaN".toDoubleOption` returns
  `Some(NaN)`. The shipped comparator uses `Double.compareTo` (`java.lang.Double.compare`) for tier 1, which
  is a genuine total order placing `NaN` last, so transitivity would hold even if these values stayed in
  tier 1 — this is **not** a transitivity requirement. Excluding `NaN`/`Infinity` from tier 1 is a
  data-semantics choice instead: a value that only looks numeric but coerces to `NaN`/`Infinity` is junk
  data, not something a user meant to rank above every genuine number, so it belongs alongside `"n/a"` in
  the non-coercible tier. This exclusion is unpinned by mutation A/B/C, which only perturb tier *order*, not
  tier *membership* — see mutation D and the strengthened 2.7 fixture in `mutation-evidence.md`. The
  property test's value set must include `"NaN"` so the membership rule is proven, not assumed.
- **Numeric/string duplicates of the same value** (e.g. `9` and `"9"`) compare equal in tier 1; `sortWith`'s
  stability then decides their relative order → acceptable and consistent, but the antisymmetry assertion
  must be written to permit equality rather than demand strict inequality.
- **Behaviour change is user-visible** for partly-numeric columns that previously produced an arbitrary
  order → that arbitrary order was the defect; there is nothing to preserve compatibility with.

## Migration Plan

None — no schema, no data, no API surface. Pure in-process comparator change; rollback is a revert.

## Planner Notes

Self-approved: using the existing `PipelineRowJson.toDouble` for tier classification rather than
introducing a separate coercion helper (avoids a second, divergent definition of "numeric"); keeping the
comparator inline in `sortWith` versus extracting a named private method — the executor may extract it if
the scaladoc requirement in D1 reads better on a named method, which is a style call, not a design one.

Escalated, not self-approved: the ordering semantics themselves (D1), answered `numeric-tier-first`.
