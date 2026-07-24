## Context

Existing ops live in `backend/src/main/scala/com/helio/domain/steps/`. `unpivot` is the inverse of
`pivot` (HEL-375, PR #280): where `pivot`'s output arity is data-dependent (one column per distinct
runtime value, unknowable from config alone — `inferPivot` deliberately omits the dynamic value
columns), `unpivot`'s output arity is **fully static** — the output schema is exactly `idVars` +
`varName` + `valueName`, all determinable from `UnpivotConfig` and `inputSchema` alone, no data
sampling required. This design follows `SelectStep.scala`/`CastStep.scala` as codec templates (per
the ticket) and `PivotStep.scala`/`inferPivot` as the closest sibling reshaping op for collision and
tolerant-decode conventions, plus `datebucket` (HEL-378) for the "replace-in-place on name collision"
schema-list-building pattern used where `pivot`'s `Map ++` trick doesn't apply to a `Vector[SchemaField]`.

## Goals / Non-Goals

**Goals:**
- Execute `unpivot`: one output row per (input row × `valueVars` entry); `idVars` carried unchanged
  onto every emitted row; `varName` cell = the source column's name (string); `valueName` cell = that
  column's raw cell value (no coercion).
- Analyze `unpivot` deterministically — full apply/infer parity on the entire output schema (not just
  a subset, unlike `pivot`), since nothing here is data-dependent.
- Existence-validate `idVars`/`valueVars` against `inputSchema` (parity with `inferPivot`'s
  unknown-field check), rather than silently producing a schema for fields that don't exist.

**Non-Goals:**
- Sampling source rows during analyze — not needed here (unlike `pivot`, unpivot has nothing that
  *would* benefit from sampling; it's already fully static).
- Type coercion of the `valueName` cell to the inferred common type at execute time — the analyze
  path reports a *declared* type for downstream consumers; the raw cell value is passed through
  unchanged at execution, mirroring `PivotStep`'s `"first"` agg (raw, un-coerced passthrough) and
  the general principle that only `cast` performs actual type coercion.

## Decisions

**1. Config field order `UnpivotConfig(idVars, valueVars, varName, valueName)` matches the ticket's
literal spec — kept as-is**, consistent with `PivotConfig`'s precedent of preserving ticket field
order verbatim so ticket acceptance-criteria language and implementation stay in lockstep.

**2. `varName`/`valueName` are non-`Option[String]` wire fields (ticket's literal type), but tolerant
`decode` defaults them to `"variable"`/`"value"` when absent from raw JSON** — mirrors
`PivotConfig.decode`'s `StepCodecUtil.stringOr(obj, "agg", "")` pattern, except the fallback here is
the ticket's named default instead of empty string, since a blank `varName`/`valueName` would emit
an unusable/empty-string column name. `idVars`/`valueVars` decode via the same `JsArray` →
`collect { case JsString(s) => s }` pattern `PivotConfig.decode` uses for `index`, defaulting to
`Vector.empty` when absent or malformed.

**3. Execution order: one row per `(input row, valueVar)` pair, nested in that order — outer loop
input rows (input order preserved), inner loop `valueVars` (config order preserved).** This groups
all of one input row's emitted rows contiguously, matching the ticket's "N value columns → N rows per
input row" phrasing literally and giving predictable, reproducible output ordering (no data-dependent
sort or grouping, unlike `pivot`'s `groupBy`).

**4. Unconditional row emission — a `valueVar` missing from a given row emits `valueName = null`
rather than being skipped.** Unlike `pivot`'s per-row `column`-value-null exclusion (which is
data-dependent, since which rows have a null `column` value is unknown until runtime), `unpivot`
iterates the *configured* `valueVars` list, which is static per step — skipping some rows for some
`valueVars` would make the row count data-dependent again, undermining the "statically knowable"
design goal that also governs the analyze contract (Decision 6). `idVars` similarly use
`row.getOrElse(name, null)` — a missing `idVar` field yields `null`, not a dropped row (mirrors
`PivotStep`'s `indexFields.map(name => row.getOrElse(name, null))`).

**5. Collision resolution: `varName`/`valueName` win over `idVars` (and `valueName` wins over
`varName` if they're equal), via `Map` `++` in execution — same "derived data wins" convention as
`PivotStep` (`indexMap ++ valueColumnsMap`) and `AggregateStep`.** Built as
`idMap ++ Map(varName -> sourceColumnName, valueName -> cellValue)` per emitted row; Scala `Map`'s
`++` right-biases on key collision, so this needs no explicit dedup logic.

**6. `inferUnpivot` output schema = `idFields` (types looked up from `inputSchema` by name) with
`varName` appended as `string`, then `valueName` appended as the common/widened type — each append
using `filterNot(_.name == X) :+ SchemaField(X, ...)` to replace an existing same-named field rather
than duplicate it (the `Vector[SchemaField]` equivalent of Decision 5's `Map ++`, matching
`inferDateBucket`'s exact `filterNot` + `:+` idiom since a schema is a `Vector`, not a `Map`).**
Applied in two sequential steps (`idFields` → `+varName` → `+valueName`) so `valueName` correctly
wins if it happens to equal `varName` or an `idVars` name — same right-biased "later wins" outcome as
execution's `Map ++`, expressed with `Vector` idiom instead.

**7. `valueName`'s inferred type = the common type of `valueVars` if uniform, else `string`
fallback.** Look up each `valueVars` entry's declared type in `inputSchema`; if the resulting type
set has exactly one distinct value, use it; otherwise (mixed types) fall back to `"string"`. No
actual type *widening* hierarchy (e.g. integer→number) is implemented — "common type" means
"identical declared type," full stop; any heterogeneity, however minor, degrades to `string`. This
keeps the rule simple, deterministic, and free of new precedent (the codebase has no existing
type-widening lattice to draw from — `aggResultType`'s `min`/`max` arms just pass through a single
field's declared type, not a set).

**8. `idVars`/`valueVars` field existence is validated against `inputSchema`; any unknown name
produces a real `validationError` with the identity-fallback contract (`outputSchema = inputSchema`
unchanged), exactly mirroring `inferPivot`'s `index`/`column`/`values` existence check.** This
catches genuine misconfiguration (e.g. a typo'd column name) instead of silently emitting a schema
entry with a fabricated type for a nonexistent field.

**9. `UnpivotStepResponse`/`UnpivotAnalyzeStepResponse` use the standard `jsonFormat6` shapes** —
`(id, pipelineId, position, createdAt, updatedAt, config)` for the step response and
`(id, position, config, inputSchema, outputSchema, validationError)` for the analyze response,
identical field counts/order to every sibling op (`PivotStepResponse`/`PivotAnalyzeStepResponse`).

**10. Flyway migration VNN is NOT hardcoded here** — re-run `ls backend/src/main/resources/db/
migration/ | sort` immediately before writing the migration file (concurrent v1.6 lanes may have
claimed a number; main was at V66 as of HEL-376/PR #281), and again immediately before the delivery
push.

## Risks / Trade-offs

- [Risk] Row-count multiplication (`N * len(valueVars)`) can produce very large outputs for wide
  sources with many `valueVars` and many rows. → Mitigation: same class of risk as `pivot`'s grouped
  output or any reshaping op; no new guardrail added here (out of scope — matches the codebase's
  existing no-row-limit convention on transform steps; `limit` is a separate, composable op).
- [Risk] `valueName`'s "all-or-nothing" common-type rule (Decision 7) degrades to `string` even for
  closely related numeric types (e.g. `integer` + `number`), which is a stricter fallback than a
  human might expect. → Mitigation: documented behavior; simplicity over a speculative widening
  lattice with no existing precedent; `cast` remains available downstream if a caller wants a
  specific type.
- [Risk] `varName == valueName` in config (both defaulted or user-set to the same string) would
  collapse to a single output column via Decision 5/6's "later wins" rule, silently dropping the
  `varName` cell. → Mitigation: documented; same class of self-inflicted collision risk the codebase
  already accepts for `pivot`'s `<values>_<v>` collisions and `datebucket`'s `outputColumn` collision
  with an existing field; no new validation guard added (frontend UI can nudge distinct defaults but
  execute-time here stays tolerant, matching every other op's collision posture).

## Planner Notes

- Frontend `UnpivotConfig.tsx` follows `PivotConfig.tsx`'s props shape (`config`/`analyzeSchema`/
  `analyzeColumns`/`onChange`) with multi-selects for `idVars`/`valueVars` (mirroring `PivotConfig`'s
  `index` multi-select rows) plus two text inputs for `varName`/`valueName` pre-filled with the
  `"variable"`/`"value"` defaults. Self-approved: matches the "study an existing op" ticket
  instruction; no new UI primitive needed.
- `unpivotConfigOf` in `stepNarrowing.ts` mirrors the existing `pivotConfigOf` narrowing-helper
  shape exactly (same generic pattern every op's `<op>ConfigOf` helper follows).
