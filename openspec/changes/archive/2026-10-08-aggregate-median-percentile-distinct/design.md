## Context

`AggregateStep` (`backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala`) owns
`SupportedFunctions` and `apply`, which has two branches: the empty-input/empty-groupBy branch
(HEL-905: one row, `count = 0`, other fns `null`) and the grouped branch. Each branch checks the fn
against `SupportedFunctions` and throws `StepConfigError` otherwise. Numeric coercion goes through
`PipelineRowJson.toDouble` (numbers, BigDecimal, numeric strings via `toDoubleOption`; everything
else `None`) — this is how HEL-857-era all-string CSV columns aggregate today.

`PipelineAnalyzeService` has `validateAggregate` (called from `validateStepConfig`, which
`AutoRunTriggerService` also uses via `stepConfigProblem` since HEL-1279) and `inferAggregate`,
which types each alias via the private `aggResultType(fn, field, inputSchema)` shared with
`inferGroupBy`. `inferAggregate` passes the RAW fn (not lowercased) to `aggResultType` — an
un-lowercased `"SUM"` infers `string` while apply lowercases and computes a Double (pre-existing
parity bug on the aggregate path; groupby already lowercases).

Driver-checklist items verified against the tree:
- No new op → no Flyway op CHECK change and no `allowedOps`/catalog change (function names live inside
  the step's config JSON; grep of `db/migration` for aggregate fns: zero hits).
- Spark (HEL-202, dormant): `SparkJobSubmitter` maps `AggregateStep` to "not yet supported on the
  Spark execution path" — no Spark compilation exists, so there is no parity obligation.
- helio-mcp: no aggregate function enumeration exists (only op names in `write.ts`); pipeline configs
  pass through to backend validation. Nothing to edit there.
- Agent docs that enumerate aggregate fns: `RefinementPrompt.scala:54-55`,
  `RefinementEditShape.scala:164`.
- Output render-time `aggregation` (`OutputConfigValidation.scala`, HEL-1313: `agg` ∈
  count|sum|avg|min|max) is a DIFFERENT feature and **stays as is**. Likewise the smart shapes
  (`SingleRowShape`, `TimeSeriesShape`, `PivotMatrixShape` — their own fn sets, including
  `PivotMatrixShape.AggregateStepSupportedAggs`) and `OutputSummaryReducer` stay as is: the ticket
  scopes the aggregate step only.

## Goals / Non-Goals

**Goals:**
- `median`, `percentile` (with `p`), `count_distinct` in apply, validation, inference and the editor.
- One validation function shared by apply and the analyze validator; one result-type table plus a
  parity test iterating `SupportedFunctions`.
- Agent-doc fn lists derived from `SupportedFunctions` so they cannot drift.

**Non-Goals:**
- Output chart/metric `aggregation` (HEL-1313), smart-shape fn sets, groupby/pivot/window steps.
- Spark compilation of `AggregateStep`.
- Fixing the pre-existing min/max inference gap (infer reports the field's declared type; apply
  returns a Double) — a follow-up, not this ticket.
- A Flyway migration.

## Decisions

1. **Wire shape: `Aggregation(alias, fn, field, p: Option[Double] = None)`.** `p` is a plain number
   on a 0–100 scale (inclusive), matching the ticket's "p50/p90/p95 or 0-100" framing and how users
   name percentiles. Alternatives rejected: fn names `p50`/`p90` (unbounded fn set, no p99.9); a 0–1
   fraction (Postgres-style, but mismatched to how the dashboard author thinks). spray-json omits
   `None`, so existing configs round-trip byte-identically. A non-numeric `p` is a malformed config
   (existing decode-error path).

2. **`p` rules (one function, two callers).** Add `AggregateStep.aggregationProblem(agg): Option[String]`
   returning, in order: unsupported fn (existing message, still built from `SupportedFunctions`);
   `percentile` with no `p` ("percentile requires 'p' (0-100)"); non-finite or out-of-range `p`
   ("percentile 'p' must be between 0 and 100, got X"); `p` on a non-percentile fn ("'p' is only valid
   for percentile, not '<fn>'"). Callers:
   - **Write time (skeptic design-1 option (a)).** `AggregateStep.companion` overrides
     `validateRawConfig` as `super.validateRawConfig(raw).orElse(<decode; first aggregationProblem>)`,
     on the `ComputeStep.scala:98-103` precedent (decode failure → `None`, leaving the existing
     malformed-config category to the caller). That rejects on every path that already calls
     `validateRawConfig`: REST step create (`PipelineService.scala:1831`, `addStepReporting`, also
     behind MCP `add_pipeline_step`), step update (`PipelineService.scala:2185`), proposal
     validate/apply (`PipelineProposalService.scala:296`) and patch-set apply
     (`PatchSetApplyResolvers.scala:205`), with whatever status those paths already return for a
     `validateRawConfig` problem (422 on REST) — no new status code. **Unsupported fn names are
     rejected at write time too**: the editor only ever offers supported fns, an unsupported one
     already fails at run time, and an agent is better served by a write-time error. Consequence,
     accepted: an update to an already-stored config with an unsupported fn returns 422 until the fn
     is fixed.
   - **Analyze / auto-run.** `validateStepConfig` already short-circuits on a non-empty
     `validateRawConfig` result (`shapeRejection`, `PipelineAnalyzeService.scala:370-373`), so the
     write-time override is what analyze and `stepConfigProblem` report — exactly once.
     `validateAggregate` is reduced to the same `aggregationProblem` call (now only reachable if the
     override were bypassed) or removed; either way a single invalid aggregation yields exactly one
     message, asserted by test.
   - **Run time.** `apply` calls it for every aggregation up-front (before either branch, so empty
     input is validated too) and throws `StepConfigError` — covers configs stored before this change.
     Not moved into `requiredConfigProblems` (that would double-report alongside `validateRawConfig`).
   - **Out of scope:** transactional pipeline create (`buildStepsAction`) does not call
     `validateRawConfig` for ANY step kind today; wiring it in is a cross-kind behavior change and is
     listed as a follow-up. On that path an invalid aggregate config is still caught by analyze,
     auto-run and apply as above.
   - `AggregateConfig.decode`'s error text (`AggregateStep.scala:38`) is updated to
     "an array of {alias, fn, field, p?} objects".

3. **Percentile method: linear interpolation (PostgreSQL `percentile_cont`).** Sorted numeric values
   v[0..n-1]; h = (n-1)·p/100; result = v[⌊h⌋] + (h-⌊h⌋)·(v[⌈h⌉]-v[⌊h⌋]). Chosen over nearest-rank
   (`percentile_disc`) because it is what Postgres/pandas/numpy default to, so helio-news's
   Python-computed p50/p90/p95 numbers reproduce exactly. `median` ≡ percentile(50), hence an even
   count yields the mean of the two middle values. Implemented once (`percentileOf(sorted, p)`) and
   used by both fns.

4. **Value domain.** `median`/`percentile` use exactly the `nums` set sum/avg use
   (`PipelineRowJson.toDouble`) — numeric strings participate, nulls and non-numeric strings are
   ignored — minus `NaN` (a `"NaN"` string parses to NaN; NaN has no rank, so it is excluded).
   ±Infinity are kept and ordered normally; `percentileOf` returns `v[lo]` when `v[lo] == v[hi]`
   (so [Inf, Inf] at a fractional position yields Inf, not NaN). Result: `Double`, or `null` when no values remain.
   `count_distinct`: distinct non-null RAW values of any type (Scala cooperative equality, so `1L`
   and `1.0` count once; the string `"1"` and the number `1` are distinct values), as `Long`.

5. **Empty/null semantics.** Empty input + empty groupBy (HEL-905 branch): `median`/`percentile`
   null, `count_distinct` `0L` (mirrors `count`). A real group whose field is all null:
   `median`/`percentile` null, `count_distinct` 0. Empty input + non-empty groupBy: zero rows
   (unchanged).

6. **Inference.** `aggResultType` gains `median | percentile → "float"`, `count_distinct →
   "integer"`. `inferAggregate` lowercases fn before calling it (fixes the pre-existing case bug on
   this path and matches `inferGroupBy`). `GroupByStep.SupportedFunctions` is unchanged, so the new
   cases are unreachable from groupby. Edits stay inside `validateAggregate`/`inferAggregate`/
   `aggResultType` (HEL-1235/HEL-1267 are queued behind this on the same file).

7. **Parity test.** One spec iterates `AggregateStep.SupportedFunctions` (no hand-copied list), builds
   a one-aggregation config per fn (`p = 50` for percentile) over a float-typed field, runs `apply`
   and `analyze`, and asserts the runtime value's type maps to the inferred type (Double→float,
   Long→integer). A new fn added without an inference case fails it. Must be shown red by mutation
   (e.g. remove the `count_distinct` case) before it is trusted.

8. **Doc-drift guard.** `RefinementPrompt`/`RefinementEditShape` interpolate
   `AggregateStep.SupportedFunctions.mkString("|")` and mention that `percentile` needs `p` (0-100),
   instead of a hardcoded list; a test asserts each prompt contains every supported fn.

9. **Frontend.** `AGG_FNS` gains the three fns, `FN_HINTS` gains hints (median: "Middle numeric value;
   mean of the two middle values for an even count; ignores nulls and non-numeric"; percentile:
   "Value at percentile p (0-100), linearly interpolated; ignores nulls and non-numeric";
   count_distinct: "Counts distinct non-null values in the field"). `Aggregation`/`AggregationRow`
   gain `p?: number`. When fn is `percentile` a numeric `p` input (aria-label `Percentile p N`, min 0,
   max 100) renders in that row; switching fn to `percentile` seeds `p: 50`; switching away deletes
   `p`. A cleared, non-numeric or out-of-range `p` input shows an inline error for that row and does
   NOT emit (the row keeps its last valid `p`) — so the editor never saves a config the write path
   would 422. Server-side rejection (decision 2) remains the authoritative check. Follow existing `DESIGN.md` tokens/components (`TextField` or the repo's
   numeric input) — no new styling.

## Risks / Trade-offs

- [Percentile is O(n log n) per group via sort] → acceptable for in-process engine row volumes;
  the engine already materializes groups in memory.
- [count_distinct treats `"1"` and `1` as different] → documented; consistent with how groupBy keys
  already compare raw values.
- [Infinity results serialize however Double infinities already do for sum] → no new behavior class.
