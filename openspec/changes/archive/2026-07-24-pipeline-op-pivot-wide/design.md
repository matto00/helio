## Context

Existing ops live in `backend/src/main/scala/com/helio/domain/steps/`. `AggregateStep.scala` groups
rows by `groupBy` fields and emits one column per **statically declared** aggregation alias
(`AggregateConfig.aggregations: Vector[Aggregation]`) — the config itself enumerates every output
column. `pivot` is different: the output value columns are one-per-**distinct-runtime-value** of
`column`, unknowable from the config or the input schema alone. `PipelineAnalyzeService.inferX`
functions are pure schema-math (no data access) — `analyze_pipeline` never samples rows. This design
covers execution (`PivotStep.evaluate`, full data access) and analyze (`inferPivot`, schema-only, no
data access) as two genuinely different problems, following the `datebucket` (HEL-378, PR #279)
wiring checklist as the freshest full-stack precedent.

## Goals / Non-Goals

**Goals:**
- Execute `pivot`: long → wide, one row per `index` tuple, one column per distinct `column` value.
- Analyze `pivot` without sampling data or raising a spurious `validationError` for the
  unenumerable dynamic columns.
- Apply/infer parity for the statically-knowable part of the contract (the `index` fields).

**Non-Goals:**
- Sampling source rows during analyze to preview real distinct pivot values (out of scope; no
  existing op does this — `analyze_pipeline` is schema-only by design).
- The pivot/matrix smart shape (HEL-337) — consumes this op, not built here.

## Decisions

**1. Value-column naming: `<values>_<v>`, not bare `v`.**
Chosen over bare `v` because (a) it self-documents which metric field the pivoted column holds when
a dashboard user is scanning a wide table with no other context, and (b) it measurably lowers
collision odds with `index` field names picked from real-world data (e.g. pivoting `column="region"`,
`values="revenue"` on distinct value `"west"` produces `revenue_west`, not the bare token `west`
which could plausibly collide with an `index` field literally named `west` in edge-case data).
Documented in `PivotStep`'s scaladoc and the `pipeline-pivot-op` spec.

**2. Collision resolution: value columns win over index/each other, following the codebase's
existing "derived data wins" convention.**
`AggregateStep.apply` does `keyMap ++ aggMap` (aggregation results override group-key values on
name collision); `inferDateBucket` does `inputSchema.filterNot(_.name == resolvedName) :+ ...`
(new field replaces old). `PivotStep.apply` mirrors this: `indexMap ++ valueColumnsMap` — if a
value-column name collides with an index field or another value column (possible if `<values>_<v>`
stringifications collide, e.g. two distinct raw values with the same `.toString`), the
later-computed value column wins. Documented as a known, low-probability edge case, not treated as
an error (parity with the rest of the collision-tolerant op set).

**3. Rows with a `null` `column` value are excluded from value-column assignment but the `index`
group they belong to still emits a row (with only its index fields populated, if no other row in
that group has a non-null `column` value).**
Grouping happens in two stages: (a) group all rows by `index` (this determines which output rows
exist at all — mirrors `AggregateStep`'s `groupBy` semantics exactly, including a `null` index
value being a valid group key), then (b) within each group, further group by non-null `column`
values to compute one `agg(values)` per distinct value. A group where every row has a `null`
`column` still emits — just with no value columns — rather than being silently dropped, keeping the
`index`-driven row count predictable and matching `AggregateStep`'s "empty groupBy collapses to one
row" precedent of never dropping a would-be output row for data reasons alone.

**4. `agg` supports `sum`/`count`/`avg`/`min`/`max`/`first` — a superset of `AggregateStep`'s five
(no `first`).**
`sum`/`avg`/`min`/`max` reuse `AggregateStep`'s numeric-coercion behavior (`PipelineRowJson.toDouble`,
nulls/non-numeric ignored) for consistency with the existing aggregate op's documented (if
debatable) contract. `count` counts non-null `values` cells in the group+value bucket. `first`
(new) returns the raw (un-coerced) `values` cell of the first row encountered, in the row order
`PivotStep.evaluate` receives them (source/pipeline order at that point in the chain — no implicit
sort) — added because, unlike `aggregate`, `pivot` commonly pivots non-numeric categorical/text
values where `sum`/`avg` are meaningless and a representative raw value is what's wanted. An
unsupported `agg` string throws `IllegalArgumentException` with the supported-set listed, exactly
mirroring `AggregateStep.apply`'s `case other => throw ...` arm.

**5. `analyze_pipeline` output schema for `pivot` = `index` fields only (types carried through from
`inputSchema`), zero static value-column entries, and `validationError = None` purely because the
value columns are unenumerable.**
This is the "no static value columns + no error" option from the ticket, chosen over emitting a
sentinel field because a sentinel field would leak into every downstream step's schema-driven field
picker (e.g. a `select`/`compute` step immediately after `pivot` derives its available-fields
dropdown from `inputSchema`, which is the prior step's `outputSchema` — see
`frontend/src/features/pipelines/ui/SelectFieldsConfig.tsx` et al.) as a fake, non-selectable
column, which is worse UX than simply not listing dynamic columns at all. A real `validationError`
is still raised — with `inputSchema` passed through as the identity-fallback `outputSchema`,
matching every other `inferX`'s failure contract — when `column` or `values` reference a field name
absent from `inputSchema`, or any `index` field name is absent from `inputSchema` (existence
validation, same pattern as `inferSplitText`'s unknown-field check). This satisfies the acceptance
criterion ("NO false `validationError`") while still catching genuine misconfiguration. Documented
limitation: users won't see pivoted column names in the UI until they run the pipeline (dry-run /
data preview), only in the `index` fields via the schema-driven pickers — acceptable since no
existing op previews computed values either.

**6. `PivotAnalyzeStepResponse` needs no extra field beyond the standard six
(`id`/`position`/`config`/`inputSchema`/`outputSchema`/`validationError`)** — same `jsonFormat6`
shape as every other analyze response (decision 5 means there's nothing dynamic left to carry).

**7. Flyway migration VNN is NOT hardcoded here** — re-run `ls backend/src/main/resources/db/migration/
| sort` immediately before writing the migration file (concurrent v1.6 lanes may have claimed a
number), and again immediately before the delivery push.

## Risks / Trade-offs

- [Risk] Two distinct `column` values stringify to the same `<values>_<v>` name (e.g. differing only
  by type that both `.toString` to `"5"`) → silently merged, later-computed wins (Decision 2).
  → Mitigation: documented behavior, not a crash; same class of risk `AggregateStep`/`inferDateBucket`
  already accept for their own collisions.
- [Risk] `min`/`max` on non-numeric `values` silently produce `null` (parity with `AggregateStep`,
  which has the same behavior today) rather than falling back to `first`-like raw-value comparison.
  → Mitigation: matches existing `aggregate` op contract exactly; not a regression, and `first` is
  available for non-numeric use cases.
- [Risk] Downstream steps can't schema-pick pivot's dynamic value columns (Decision 5).
  → Mitigation: documented; dry-run/data-preview remains the discovery path, same as for any
  data-dependent op output.

## Planner Notes

- Config field order `PivotConfig(index, column, values, agg)` matches the ticket's literal spec —
  kept as-is (no reordering) so the ticket's acceptance-criteria language and the implementation
  stay in lockstep.
- `PivotConfig.index: Vector[String]` (bare field names, no per-field `type` like
  `AggregateConfig.groupBy: Vector[AggregateField]`) — `inferPivot` looks up each index field's type
  from `inputSchema` by name (same lookup pattern `inferSelect` uses), so no type duplication is
  needed in the wire config. Self-approved: simpler wire shape, no precedent requires per-field type
  hints on `index`.
- Frontend `PivotConfig.tsx` follows `AggregateConfig.tsx`'s props shape
  (`config`/`analyzeSchema`/`analyzeColumns`/`onChange`) for a multi-select `index` field list (rows
  with add/remove, mirroring `AggregateConfig`'s `groupBy` rows) plus single-field dropdowns for
  `column`/`values` and an `agg` dropdown seeded with `sum`/`count`/`avg`/`min`/`max`/`first` (a new,
  `pivot`-local `PIVOT_AGG_FNS` constant — not reusing `AggregateConfig`'s `AGG_FNS`, which lacks
  `first`). Self-approved: matches the "study an existing op" instruction in the ticket, no new UI
  primitive needed.
