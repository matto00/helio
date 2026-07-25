## Context

HEL-391 (merged, PR #288) landed `PipelineShape`/`Registry`/catalog with `PassthroughShape`.
HEL-393 (merged, PR #289, commit `3d4b0c07`) landed `SingleRowShape`, the first real shape
(`RowCountContract.ExactlyOne`). This ticket is the second concrete shape (`top-n`), the first
real consumer of `RowCountContract.AtMostParam`, built purely on `SortStep`/`LimitStep`
(`backend/src/main/scala/com/helio/domain/steps/`) — no new op, no migration.

## Goals / Non-Goals

**Goals:**
- Register `top-n`: `measure`/`direction`/`n`/`ties` params → `sort` + `limit` expansion.
- A deterministic, tested ties policy for the default (`strict`) path.
- Declare `outputContract = OutputContract(RowCountContract.AtMostParam("n"), Vector.empty, ...)`.
- Fix `SingleRowShape`'s `fn` case-sensitivity inconsistency (HEL-393 review follow-up #1).
- Add a named-shape catalog HTTP assertion (HEL-393 review follow-up #2).

**Non-Goals:**
- Per-group (partitioned) top-N — needs `window`'s `partitionBy` plus a rank-based filter
  (`LimitStep` has no partition concept); not trivial, filed as a HEL-337 spinoff (Decision 5).
- `keep-ties`/dense ties variant — same `window` dependency; `expand` rejects it with a `Left`
  pointing at the spinoff rather than silently ignoring it (Decision 3).
- Runtime enforcement that execution actually yields ≤N rows (same declared-not-enforced posture
  as `single-row`'s `ExactlyOne`, HEL-393 design.md Risk 1).

## Decisions

**1. Expansion is exactly two steps: one `sort` (single key: `measure`/`direction`) then one
`limit` (`n`).** Mirrors `SortConfig(sortBy: Vector[SortKey])`/`LimitConfig(count: Int)` directly —
no new case classes. `direction` is passed through to `SortKey.direction` unchanged; `SortStep`
already treats it case-insensitively (`direction.equalsIgnoreCase("desc")`), so no normalization is
needed at the config layer — only expand-time *validation* that it's a recognized value (Decision 2).

**2. `expand` validates before building steps** (mirrors `SingleRowShape` Decision 3): `measure`
must be a non-empty string; `direction` must be `"asc"`/`"desc"` case-insensitively (reusing the
same convention `combinator` established, now also applied to `SingleRowShape.fn` — Decision 4);
`n` must be a positive `Int` (`n <= 0` is rejected with `Left`, rather than passed through to
`LimitStep`, whose own `count <= 0` no-op-passthrough semantics would silently violate the
`AtMostParam("n")` contract — a stricter failure mode than the step's own runtime behavior, same
rationale as `SingleRowShape`'s `fn`/`operator` checks). `ties` is optional, defaults to
`"strict"`; any other value returns `Left` naming the deferral (Decision 3).

**3. `ties: "strict"` is the only implemented value; anything else is a validation error, not a
silent fallback.** `strict` means exactly-what-`sort`+`limit`-produce: the boundary between the
Nth and (N+1)th row is broken by `SortStep`'s stable sort, which preserves each tied row's
*original input order* — the same tie-break *outcome* `WindowStep` achieves explicitly via an
index-augmented `Ordering` (design.md precedent cited in the ticket), reached here for free because
`SortStep`'s own scaladoc already documents its sort as a multi-key **stable** sort. This is
asserted directly in `TopNShapeEngineSpec` (two rows tied on `measure`, `n` splits them, original
input order decides which one is kept). *Alternative rejected*: silently coercing an unrecognized
`ties` value to `"strict"` — masks a caller typo instead of surfacing it, inconsistent with every
other shape's validate-before-build posture.

**4. Fix `SingleRowShape.expandAggregate`'s `SupportedFns.contains(m.fn)` to
`SupportedFns.contains(m.fn.toLowerCase)`** (one-line, single-file). Contained because
`AggregateStep.apply` (the step that actually executes) already does `agg.fn.toLowerCase` before
matching — the shape's own validation was strictly *more* restrictive than the engine it guards,
rejecting e.g. `"SUM"` at `expand`-time even though `AggregateStep` would happily execute it. This
also brings `fn` in line with `combinator`'s existing case-insensitive convention. `operator`
(filter mode) is untouched: `FilterStep.evalCondition` matches operators case-sensitively at
runtime too, so no inconsistency exists there — "match whichever convention" only had one real gap.

**5. Global top-N only; per-group top-N filed as a HEL-337 spinoff, not attempted here.** A
per-group variant needs `window`'s `partitionBy` to rank within each group plus a way to keep only
rows with `rank <= n` per partition — `LimitStep` has no partition awareness, so this would require
either a new `filter`-on-computed-column two-step recipe (rank via `window`, then `filter` with
`operator = "<="` against `n`) or a new step kind. Real design work, not "trivially added" — ticket
explicitly permits deferring with a note. *Alternative considered*: build the `window`+`filter`
recipe now since both ops already exist on main — rejected because it needs its own ties-policy
design (per-partition tie-break, `rank` vs `dense_rank` choice) that deserves its own design gate,
not tacked onto this ticket's scope.

## Risks / Trade-offs

- **[Risk]** `n <= 0` would be a silent no-op if passed straight to `LimitStep` (returns all rows,
  the opposite of "at most N"). → **Mitigation**: `expand` rejects `n <= 0` with `Left` before any
  step is built (Decision 2).
- **[Risk]** A caller expecting `keep-ties` behavior gets a hard `Left` instead of a partial
  implementation. → **Mitigation**: intentional — a wrong `strict` result for a `keep-ties` request
  would be silently misleading; a `Left` naming the spinoff is honest and matches `SingleRowShape`'s
  precedent of surfacing unsupported values rather than approximating them.
- **[Risk]** Stable-sort tie-break is *implicit* (a property of `SortStep`'s underlying
  `sortWith`/`sorted`, not an explicit index comparator like `WindowStep`'s). → **Mitigation**:
  documented in `TopNShape`'s scaladoc with a direct reference to `SortStep`'s stability guarantee,
  and covered by a dedicated tie-break test in `TopNShapeEngineSpec` so a future `SortStep` change
  that broke stability would fail loudly here too.

## Planner Notes

- Self-approved: scoping to global-only top-N + spinning off per-group/`keep-ties` (Decision 5) —
  ticket explicitly permits "unless trivially added... otherwise note as a follow-up"; confirmed
  it's not trivial (needs a new two-step recipe design, not just wiring existing steps).
- Self-approved: the `SingleRowShape.fn` case-insensitivity fix (Decision 4) — single line, single
  file, brings validation in line with the engine's own already-case-insensitive runtime behavior;
  explicitly pre-authorized as an "inline if contained" follow-up.
- Self-approved: rejecting `n <= 0` and non-`strict` `ties` with `Left` rather than approximating —
  strictly safer than silent misbehavior, no new external dependency.
