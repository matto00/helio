## Context

HEL-391 (merged, PR #288) landed `PipelineShape`/`Registry`/catalog with `PassthroughShape`. HEL-393
(PR #289) landed `SingleRowShape` (`ExactlyOne`). HEL-394 (PR #290) landed `TopNShape`
(`AtMostParam`). HEL-396 (PR #291, `a9605a18`) landed `TimeSeriesShape` (`Unbounded`), and settled two
conventions this ticket follows: enum-ish param validation is case-insensitive when it mirrors the
underlying step's own runtime case-(in)sensitivity, and the registry-parity test + named-shape catalog
HTTP assertion get extended, not duplicated. This ticket is the fourth and last concrete shape
(`pivot-matrix`), built on `PivotStep` (HEL-375, `backend/.../steps/PivotStep.scala`) + `AggregateStep`
— no new op, no migration.

`PivotStep.apply` (read directly for this design) already performs its own per-bucket aggregation:
it groups rows by the `index` tuple, then within each group further groups by `column` value, and
applies `cfg.agg` to reduce the `values` field within each (index, column) bucket into a single
`<values>_<v>` cell. Critically, `cfg.agg` matching in `PivotStep.apply` is an exact, case-sensitive
string match against `Vector("sum", "count", "avg", "min", "max", "first")` — no `.toLowerCase`
anywhere in that method (unlike `AggregateStep.apply`, which lowercases `fn` before matching). `"first"`
(raw, un-coerced first-row-in-bucket) has no equivalent in `AggregateStep`, which supports only
`sum`/`avg`/`min`/`max`/`count`.

## Goals / Non-Goals

**Goals:**
- Register `pivot-matrix`: `index`/`column`/`values`/`agg` params → conditional `aggregate` + `pivot`
  expansion, one row per distinct `index` tuple.
- Make the "optional pre-aggregate" from the ticket text a real, non-arbitrary condition rather than a
  caller-supplied toggle param (the ticket's stated param list is exactly `index`/`column`/`values`/`agg`
  — no fifth boolean), and ground that condition in `AggregateStep`'s actual supported-function set.
- Declare `outputContract = OutputContract(RowCountContract.Unbounded, Vector.empty, ...)`, consistent
  with `PivotStep`'s own documented data-dependent, never-statically-enumerated value-column set
  (HEL-375 design.md: analyze returns an index-only schema; missing dynamic columns are not a
  validation error).
- Guard the collision hazard specific to this shape: a pre-aggregate alias overwriting an `index`/
  `column` groupBy key via `AggregateStep`'s `keyMap ++ aggMap` merge.
- Extend the registry-parity test and named-shape catalog HTTP assertion (four-shape precedent).

**Non-Goals:**
- A caller-supplied toggle for whether to pre-aggregate — the condition is derived from `agg` itself
  (Decision 1), not exposed as a separate param, keeping the param list exactly what the ticket states.
- Statically enumerating pivot's `<values>_<v>` output columns in `outputContract.fields` — structurally
  impossible (`outputContract` is a static `val`, `expand`-params-blind) and dishonest anyway, since the
  column set is data-dependent even at `expand`-time. `fields = Vector.empty`, per the epic-wide
  precedent and per the human's separate epic-level `OutputFieldContract` design question.
- Runtime enforcement that the declared `Unbounded` contract holds — same declared-not-enforced posture
  as every sibling shape.

## Decisions

**1. The pre-aggregate `aggregate` step is emitted if and only if `agg` is one of
`sum`/`avg`/`min`/`max`/`count` (all supported by `AggregateStep`); it is omitted when `agg = "first"`.**
This is not an arbitrary toggle — `AggregateStep.apply`'s `fn` match has no `"first"` case at all (only
`sum`/`avg`/`min`/`max`/`count`), so an `aggregate` step configured with `fn = "first"` would throw
`IllegalArgumentException: Unsupported aggregation function: first` at *execution* time. Conversely,
`"first"` needs no pre-collapse: `PivotStep.apply` already implements exactly "first row in this
(index, column) bucket, raw and un-coerced" as its own native `"first"` case — running a redundant
upstream reduction would add a step for no behavioral gain. This is the concrete, ticket-consistent
meaning of "optional": present for every `agg` value except the one value `PivotStep` already handles
natively and `AggregateStep` cannot express. *Alternative considered*: always emit both steps,
hardcoding the pre-aggregate's `fn` to something other than the user's chosen `agg` when `agg = "first"`
— rejected; there is no other function whose result equals "the raw first row," so this would silently
change behavior rather than passing it through.

**2. When the pre-aggregate is emitted, `pivot`'s own `agg` is always the hardcoded literal `"first"`,
never a value derived from user input.** After the pre-aggregate collapses each `(index, column)` bucket
to exactly one row (via the user's `agg`), `PivotStep`'s inner per-bucket grouping finds singleton
groups, so any reduction function would return that one row's value — `"first"` is the cheapest correct
choice and avoids re-running the user's reduction a second time. This also means `PivotStep`'s
case-sensitive `cfg.agg` match is *never* fed directly from raw user casing: in the pre-aggregate branch
`pivot.agg` is the shape's own hardcoded `"first"` literal; in the no-pre-aggregate branch, `agg` is
validated case-insensitively against exactly `"first"` and then the canonical lowercase literal
`"first"` is written, not the user's original casing (mirrors HEL-396 design.md Decision 4's
"validate case-insensitively, normalize to the step's exact-match casing before writing" pattern, since
`PivotStep`, like `DateBucketStep`, has no internal `.toLowerCase`). The pre-aggregate's own `fn`
(`sum`/`avg`/`min`/`max`/`count`) preserves the user's original casing on the wire, since `AggregateStep`
lowercases internally at runtime — matching `TimeSeriesShape`'s/`SingleRowShape`'s precedent for that
step.

**3. `RowCountContract.Unbounded`, not `AtMostParam`.** `index` is a field-name array, not a count — it
bounds nothing numerically. The actual row count is the number of distinct `index` tuples present in the
source, unknowable at `expand`-time and not capped by any param. This is an independently-reasoned
choice for this shape (not copied from a sibling): `single-row` uses `ExactlyOne` (a fixed guarantee),
`top-n` uses `AtMostParam("n")` (a literal numeric param), and `time-series` uses `Unbounded` for the
same underlying reason as this shape (bucket/index-tuple cardinality is data-dependent) — `Unbounded` is
independently the only honest option here, not a default reused without justification.

**4. Collision hazard: reject `column` or `values` appearing in `index`, and reject `values == column`.**
When the pre-aggregate is emitted, `AggregateConfig.groupBy = index ++ [column]` and
`aggregations = [Aggregation(alias = values, fn = agg, field = values)]`. `AggregateStep.apply` builds
`keyMap ++ aggMap`; if `values` collided with an `index` field or with `column` (both `keyMap` keys), the
aggregation result would silently overwrite a groupBy key, breaking the very index/column identity the
matrix depends on — the same hazard class HEL-396 confirmed for `alias`/`timeField`. Rejecting
`values ∈ index`, `values == column`, and `column ∈ index` up front (the last is not a `keyMap ++ aggMap`
hazard per se, but a self-referential, meaningless pivot spec — a field can't simultaneously be a fixed
row key and the column-spreading category) keeps `expand` honest for both expansion branches, not just
the one that literally emits `aggregate`.

**5. `index` is validated as a non-empty `Vector[String]` of non-empty, non-duplicate field names;
`column`/`values` as non-empty strings; `agg` case-insensitively against `PivotStep`'s six supported
values (`sum`/`count`/`avg`/`min`/`max`/`first`) — a superset of `AggregateStep`'s five, matching
`PivotStep` (the step every `agg` value must ultimately be valid against), not `AggregateStep`.**
*Alternative considered*: validate `agg` against only `AggregateStep`'s five-function set, since that's
what most callers will pass — rejected; `"first"` is a legitimate, ticket-implied value (`PivotStep`
lists it as supported) and excluding it would make the shape strictly less capable than the op it wraps.

## Risks / Trade-offs

- **[Risk]** A caller who wants a genuinely *different* reduction for the pre-collapse step than for
  in-bucket pivoting (e.g., pre-collapse with `sum`, pivot-display with `max`) has no way to ask for
  that — Decision 2 always hardcodes pivot's own `agg` to `"first"` once pre-aggregated. → **Mitigation**:
  out of ticket scope (params are exactly `index`/`column`/`values`/`agg`, one function); a hand-built
  pipeline with two explicit steps remains available for that case.
- **[Risk]** `Unbounded` gives a caller (panel binding, HEL-399) no compile-time bound on row count for a
  high-cardinality `index`. → **Mitigation**: same posture as every other `Unbounded` shape; nothing here
  makes it worse than a hand-built `aggregate` + `pivot` pipeline already would.
- **[Risk]** `fields = Vector.empty` gives panel/editor consumers (HEL-402) no static column list to
  render against for the dynamic `<values>_<v>` columns. → **Mitigation**: explicitly out of scope per
  the pre-brief; this is the most honest answer given `pivot`'s own analyze-time contract (HEL-375) never
  statically enumerates those columns either — the same limitation, not a new one introduced here.

## Planner Notes

- Self-approved: deriving the pre-aggregate's presence from `agg` rather than exposing a new toggle
  param — required to keep `expand` from ever emitting an `aggregate` step `AggregateStep` cannot
  execute (`fn = "first"`), and matches the ticket's literal four-param list; not a scope expansion.
- Self-approved: the index/column/values collision guard (Decision 4) — a genuine correctness gap the
  ticket's step list implies but doesn't spell out, single-file, contained, no new dependency, directly
  requested by the pre-brief.
- Self-approved: validating `agg` against `PivotStep`'s six-value set rather than `AggregateStep`'s five
  — required for correctness (the value must ultimately satisfy `PivotStep`), not a scope expansion.
