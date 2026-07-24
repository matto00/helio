## Context

`window` is the third and last High-priority op in the HEL-336 v1.6 expansion (after HEL-378
`datebucket`, HEL-375 `pivot`). It is a partition + order op that appends one derived column per
row while preserving row count — schema-additive, unlike `pivot`'s data-dependent-arity output.
Reference templates: `SortStep.scala` (ordering via `SortKey`/comparator), `AggregateStep.scala`
(grouping via `groupBy`), `PivotStep.scala` (most recent op — current wiring pattern across
`PipelineStep.Registry`, `PipelineStepProtocol`, `PipelineStepConfigCodec`,
`PipelineAnalyzeService`/`PipelineAnalyzeProtocol`, `domain/package.scala`,
`PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`).

## Goals / Non-Goals

**Goals:**
- Partition rows by `partitionBy`, order within partition by `orderBy` (reusing `SortStep`'s
  comparator), compute one of six functions, append `outputColumn`.
- `analyze_pipeline` inference must be statically correct (no data sampling needed) per function.
- Pin partition/order/function/output-column semantics and null handling precisely enough that
  the design gate and evaluator can each independently verify by reading `WindowStep.scala`.

**Non-Goals:**
- SQL-window pushdown — always computed in-engine over already-loaded rows.
- DAG/branching — single linear step, chains like every other op.

## Decisions

**1. Config shape.** `WindowConfig(partitionBy: Vector[String], orderBy: Vector[SortKey],
function: String, field: Option[String], outputColumn: String, offset: Option[Int])` — exactly
per ticket. `orderBy` reuses `SortKey(field, direction)` from `SortStep.scala` (import, not
duplicate) so partition-internal ordering is byte-for-byte the same comparator `sort` uses
(numeric-if-both-coerce, else string; nulls sort last in both directions).

**2. Partitioning.** `rows.groupBy(row => partitionBy.map(name => row.getOrElse(name, null)))` —
identical shape to `AggregateStep.groupBy` / `PivotStep.index` grouping (a `null` partition-key
value is a valid group, consistent with the existing two precedents). Empty `partitionBy` puts
every row in a single partition (parity with `AggregateStep`'s empty-`groupBy`-collapses-to-one-
group behavior).

**3. Row order preservation.** Unlike `aggregate`/`pivot` (which collapse to one row per group),
`window` must emit one output row per *input* row, in the *original relative row order* — a
per-partition function value is computed but the row set is not reshaped. Implementation:
partition rows by key while retaining each row's original index; within each partition, produce a
*sorted view* (via the `SortStep` comparator) solely to compute the function value per row in
partition-order; then merge the computed value back onto the row keyed by original index, and
re-emit the full row sequence in original input order. This avoids silently reordering a
pipeline's output, which no other in-place op currently does — `sort` is the only existing op that
reorders, and it does so as its entire visible effect, not as a side effect of an unrelated op.

**4. Function semantics** (computed per-partition, over the `orderBy`-sorted partition view):
- `row_number`: 1-based sequential position in partition order. Ties broken by original input
  order (stable sort — `SortStep`'s `sortWith` is stable per Scala's `sortWith` contract... **note
  this is `List.sortWith`, which is NOT guaranteed stable in all cases; use `sortBy`/a manually
  stable path for `window`'s ordering to guarantee tie-break-by-input-order.** Concretely:
  `WindowStep` builds its own stable ordering by zipping rows with their original index and
  breaking ties on that index, rather than calling `SortStep.apply` directly.
- `rank`: 1-based; rows with equal `orderBy` key values (per the same equality the comparator
  uses — numeric equality if both coerce, else string equality) share the same rank; the next
  distinct value's rank skips by the number of tied rows (standard SQL `RANK()` semantics).
- `dense_rank`: like `rank` but the next distinct value's rank increments by exactly 1 (no gaps;
  standard SQL `DENSE_RANK()`).
- `running_sum`: cumulative sum of `field`'s numeric-coerced value (via `PipelineRowJson.toDouble`,
  same coercion `AggregateStep`'s `sum` uses) up to and including the current row in partition
  order. Non-numeric/absent `field` values coerce to `0` contribution (parity with `sum`'s
  `flatMap(toDouble).sum` — `None` entries are dropped, not error). If `field` is `None` in the
  config, execution fails with a descriptive error (`running_sum` requires `field`, mirroring
  `pivot`'s required-string-field validation).
- `lag`/`lead`: value of `field` from the row `offset` positions before/after the current row in
  partition order (`offset` defaults to `1` if absent; must be a positive `Int` — non-positive
  fails with a descriptive error). At partition edges where no such row exists, the output value is
  `null` (JSON `null` — same "missing value renders as null" precedent as every other op's
  `Option`-absent field). Raw (un-coerced) `field` value is copied — same type as `field`, no
  numeric coercion (parity with `pivot`'s `first` returning the raw cell).
- Any other `function` string fails at execute time with a descriptive error listing the six
  supported values (parity with `AggregateStep`/`PivotStep`'s unsupported-function error shape).

**5. Output column collision.** If `outputColumn` collides with an existing field name, the
computed value overwrites it (same last-write-wins precedent as `pivot`'s `indexMap ++
valueColumnsMap` and `aggregate`'s `keyMap ++ aggMap`) — implemented as `row + (outputColumn ->
computedValue)` per row, which is Scala `Map`'s native overwrite-on-existing-key semantics.

**6. `analyze_pipeline` inference (`inferWindow`).** Output schema = input schema with
`outputColumn` appended (or its existing entry replaced, matching decision 5's collision rule),
typed as: `integer` for `row_number`/`rank`/`dense_rank`; `number` for `running_sum`; same
declared type as `field`'s entry in the input schema for `lag`/`lead` (falls back to `string` if
`field` is absent from the input schema, mirroring how other infer-paths degrade for unknown
input fields — see `PipelineAnalyzeService`'s existing fallback pattern, confirmed by grep before
implementation). This requires no data sampling (unlike `pivot`'s data-dependent column names) —
the output column set is fully determined by config + input schema alone.

**7. Wiring surface.** Follow the `pivot` (HEL-375) pattern exactly: `PipelineStep.Registry` +
`PipelineStepKind.Window`; `PipelineStepProtocol` (`WindowStepResponse`, `jsonFormat6`, wire
union arms, `fromDomain`); `PipelineStepConfigCodec` (`encodeConfig`/`extractConfig`);
`PipelineAnalyzeService` (dispatch + `inferWindow`); `PipelineAnalyzeProtocol`
(`WindowAnalyzeStepResponse` + union arms); `domain/package.scala` type aliases;
`PipelineStepRepository.rowToDomain`; `PipelineService.toAnalyzeStepResponse`. Frontend:
`pipelineStep.ts` (`WindowConfig` type — 4 additions per the op-wiring checklist: wire type,
`OP_TYPES` entry, `defaultConfigFor` case, narrowing helper), `stepNarrowing.ts`, new
`WindowConfig.tsx` + co-located `.test.tsx`, `StepCard.tsx`, `useStepCardState.ts`. MCP:
`helio-mcp/src/tools/write.ts` `add_pipeline_step` description string (free-text `type`, not an
enum — document `window`'s config shape in prose).

**8. Flyway migration.** `V66__add_window_op.sql`, drop/re-add `pipeline_steps_op_check` per the
`V50__add_splittext_op.sql` pattern, adding `'window'` to the allowed-value list. **V66 confirmed
against `origin/main` at 1bb95832 (latest: `V65__add_pivot_op.sql`) at planning time — re-confirm
immediately before the delivery push**, since sibling v1.6 op lanes may land in parallel.

## Risks / Trade-offs

- [Risk] `List.sortWith` (used by `SortStep`) is not contractually stable, and `window`'s
  `row_number`/`rank` need a defined tie-break. → Mitigation: decision 3/4 — `WindowStep` builds
  its own explicit index-stable ordering rather than delegating directly to `SortStep.apply`.
- [Risk] `running_sum`'s numeric coercion silently drops non-numeric `field` values (contributes
  0), which could surprise a user expecting an error. → Mitigation: this exactly mirrors
  `aggregate`'s `sum` behavior (documented precedent), not a new silent-failure mode.
- [Risk] Large partitions computed in-engine (no DB pushdork) could be slow for big row counts.
  → Mitigation: explicitly out of scope per ticket; same trade-off `aggregate`/`pivot` already
  accepted.

## Planner Notes

- Capability name `pipeline-window-op` chosen for consistency with `pipeline-pivot-op`,
  `pipeline-aggregate-op`, `pipeline-date-bucket-op` naming already in `openspec/specs/`.
- No `Modified Capabilities` — purely additive, no existing spec's requirements change.
