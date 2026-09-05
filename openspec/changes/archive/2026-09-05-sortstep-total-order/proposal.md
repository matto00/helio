## Why

`SortStep`'s comparator decides numeric-vs-lexicographic ordering **per comparison pair** rather than per
column, so a partly-numeric column (`10`, `9`, `"n/a"`) compares some pairs numerically and others
lexicographically. That relation is not transitive, so it is not a total order — and `sortWith` requires
one. The result is not merely "sorted oddly": it is unspecified, varies with input order, and surfaces to
the user as a silently wrong ordering with no error. HEL-893 made CSV columns report `string` instead of a
parsed numeric type, so partly-numeric columns are now a common shape rather than an edge case.

## What Changes

- Replace the per-pair coercion fallback in `SortStep.apply` with a single, explicitly-defined **three-tier
  total order**: coercible-to-number values first (ordered numerically), then non-coercible values (ordered
  lexicographically), then nulls last. Direction (`asc`/`desc`) reverses the ordering *within* the value
  tiers; nulls remain last in both directions, preserving today's convention.
- Document the chosen semantics — and the two rejected alternatives (all-or-nothing per column;
  non-coercible values sorting first) — in `design.md` and in `SortStep`'s own scaladoc, so the tiering is
  not later "simplified" back into a branch that reintroduces the defect.
- Pin the comparator's *contract* with property-style guards over a mixed value set: irreflexivity,
  antisymmetry, and transitivity. Add fixture guards whose correct output ordering differs from their input
  ordering, and mutation-check every new guard against both rejected alternatives, not only against the
  pre-fix comparator.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `pipeline-sort-op`: the "Sort op executes multi-column stable sort" requirement currently constrains only
  null placement and stability. It gains an explicit total-order contract for non-null values, defining how
  numeric and non-coercible values order relative to each other.

## Impact

- `backend/src/main/scala/com/helio/domain/steps/SortStep.scala` — comparator rewrite and scaladoc.
- `backend/src/test/scala/com/helio/domain/steps/SortStepSpec.scala` — new contract + fixture guards. The two
  existing HEL-893 guards must continue to pass **unmodified**.
- Reads `PipelineRowJson.toDouble` unchanged; no signature or call-site changes elsewhere.
- **Commits the codebase to a numbers-before-strings cross-type ordering rule it has not stated elsewhere.**
  This is the real cost of the choice and is recorded deliberately rather than left implicit.

## Non-goals

- No database migration (the shared dev Postgres has concurrent HEL-980 / HEL-975 runs).
- No change to `PipelineRowJson.toDouble`'s coercion rules — which values coerce is out of scope; only how
  coercible and non-coercible values order relative to each other is in scope.
- No change to null placement, multi-key fold semantics, empty-`sortBy` no-op behaviour, or any frontend
  `SortConfig` surface.
- No user-facing warning or error when a column is partly numeric; the order becomes well-defined, not
  diagnosed.
