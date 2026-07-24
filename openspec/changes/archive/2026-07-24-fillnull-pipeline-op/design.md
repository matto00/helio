## Context

`fillnull` is the sixth leaf of the HEL-336 Pipeline Op Expansion epic. It follows the same
per-field, schema-preserving shape as `CastStep` (`domain/steps/CastStep.scala`): output schema
== input schema, only listed columns are touched, and it wires through the same backend surface
(`PipelineStep` registry/kind, wire protocol, config codec, analyze protocol, exhaustive-match
repository/service consumers) plus a Flyway migration and a `StepCard` editor, precedented by
`HEL-382`'s `DedupeStep` and `HEL-376`'s `WindowStep` (order-dependent, single-pass column
computation).

## Goals / Non-Goals

**Goals:**

- Backend `fillnull` op supporting five strategies: `constant`, `forwardFill`, `mean`, `median`,
  `mode`, applied to a named set of `columns`.
- `analyze_pipeline` passthrough: output schema identical to input schema (joins the
  cast/filter/limit/sort/dedupe identity group in `PipelineAnalyzeService`).
- Frontend `FillNullConfig.tsx` step-card editor + MCP `add_pipeline_step` documentation.

**Non-Goals:**

- Cross-partition forward-fill grouping (whole-batch order only, matching `WindowStep`'s
  unpartitioned decision when `partitionBy` is empty).
- Per-column strategy mixing within a single step instance (see Decision 1) — achieved instead by
  chaining multiple `fillnull` steps, consistent with how the pipeline model already composes
  single-purpose steps linearly.

## Decisions

**1. Config shape is `FillNullConfig(columns: Vector[String], strategy: String, value: Option[String])`
— one strategy per step instance, not a per-column strategy map.**
This is the literal signature specified in the ticket's Scope section. All `columns` in one step
share the same `strategy`; a user who needs different strategies for different columns chains two
`fillnull` steps (e.g., `mean` on `price`, then `constant` on `region`). This mirrors the existing
pipeline model where each step performs one operation — `CastStep`'s `casts` map is an exception
because per-field *target types* are inherent to what "cast" means, whereas `fillnull`'s strategy
is a batch-level computation mode, not a per-field property. Alternative considered: a map of
`column -> (strategy, value)` like `casts` — rejected as scope creep beyond the ticket's literal
config shape and unnecessary given step-chaining already covers the use case.

**2. Null definition: value is Scala `null` OR the key is absent from the row map — both are
"null" for fill purposes.** `PipelineRowJson.Row = Map[String, Any]`; `JsNull` decodes to `null`
via `PipelineRowJson.jsValueToAny`, and reading a row field always goes through
`row.getOrElse(field, null)` (the pattern every existing step — `CastStep`, `DedupeStep`,
`AggregateStep` — uses), which already unifies "missing key" and "explicit null". `fillnull`
follows the same pattern: a column absent from a row is treated identically to a column present
with an explicit null. Filling always uses `row + (col -> filled)`, so a filled row gains the key
if it was previously absent (parity with `CastStep`, which does the same via `r + (field -> ...)`).

**3. `constant` strategy fills every null cell in `columns` with the raw `value` string** (as an
`Any` — no type coercion attempted). `value` is required for `constant`; if absent, the step fails
at execute time with a descriptive error (mirrors `WindowStep`'s missing-`field` failure for
`running_sum`/`lag`/`lead`).

**4. `forwardFill` carries the last non-null value seen so far down the *original row order*, per
column independently.** Single left-to-right pass per column, mutable "last seen" tracker seeded
to `null`; a leading-null run (no prior non-null value yet) stays `null` — there is nothing to
carry forward. This matches the ticket's explicit note ("a leading-null region stays null") and
the same original-row-order contract `WindowStep` and `DedupeStep` already establish for
order-sensitive ops.

**5. `mean`/`median`/`mode` are computed once per column over the *entire input batch*, over
non-null values only, in a single pass, then that one computed value backfills every null cell in
that column.** `mean`/`median` require numeric coercion via `PipelineRowJson.toDouble` (existing
helper, used by `AggregateStep`); non-numeric values are excluded from the statistic, matching
`AggregateStep.avg`'s `nums.flatMap(toDouble)` pattern. `mode` works on raw (un-coerced) values —
the most frequent non-null value, ties broken by first-encountered order for determinism. If a
column has zero non-null values, the computed statistic is undefined and every cell in that column
(all of which are null, by definition) stays `null` — never a hard failure, matching
`AggregateStep.avg`'s `if (nums.isEmpty) null` precedent.

**6. Unsupported `strategy` fails at execute time with a descriptive error** listing the five
supported strategies — matches `AggregateStep`/`WindowStep`/`PivotStep`'s unsupported-function
error shape (`IllegalArgumentException` with a message naming the invalid value and the supported
set).

**7. `analyze_pipeline`: identity passthrough**, joining `PipelineAnalyzeService`'s existing
passthrough group (cast/filter/limit/sort/dedupe) — `fillnull` never adds, removes, or retypes a
column.

## Risks / Trade-offs

- [Risk] `mean`/`median` silently drop non-numeric values from the statistic rather than failing →
  Mitigation: this matches existing `AggregateStep.avg` behavior exactly; frontend column-picker
  can still list all columns (no client-side type gate), consistent with `CastStep`'s UI.
- [Risk] Filling a numeric column with a `constant` string value (e.g., `"0"` filled into a
  `price` column already holding `Double`s) mixes types within one column → Mitigation: this is
  the same trade-off `CastStep`/`RenameStep` already accept (config values are user-supplied
  strings); a follow-on `cast` step downstream can normalize the type if needed. Documented in the
  `FillNullConfig` scaladoc.
- [Risk] `mode` ties are non-deterministic if implemented via unordered grouping →
  Mitigation: explicit first-encountered tie-break using a `LinkedHashMap`-style ordered count, not
  a plain `groupBy` (which does not guarantee iteration order across runs).

## Migration Plan

- New Flyway migration extending `pipeline_steps_op_check` to add `'fillnull'`, following the
  drop/re-add pattern (`V50__add_splittext_op.sql` → ... → `V68__add_dedupe_op.sql`). **VNN is
  NOT hardcoded here** — confirm the current max via `ls backend/src/main/resources/db/migration/
  | sort` immediately before writing the migration, and re-confirm again immediately before the
  delivery push (three v1.6 op lanes may land concurrently and contend for the same number).
  Purely additive; no data migration; rollback is dropping the migration file pre-merge (no prod
  rows reference `'fillnull'` until this ships).

## Open Questions

None — ticket scope and config shape are unambiguous; strategy-per-column composition is resolved
via step chaining (Decision 1).

## Planner Notes

- Self-approved: Decision 1 (single strategy per step instance, not a per-column map) — the
  ticket's literal `FillNullConfig` signature has one `strategy`/`value` pair, and the "per-field
  config" language in the orchestrator brief is satisfied by chaining steps, not by expanding the
  config shape.
- Self-approved: `mode` tie-break rule (first-encountered) — undocumented in the ticket; chosen for
  determinism, consistent with the codebase's existing preference for stable, order-based
  tie-breaking (`DedupeStep` keep=last, `WindowStep` rank ties).
