# HEL-858: Schema inference: recursive merge with type widening across sampled rows

## Description

Found building dashboards over the live Sleeper API (`/home/matt/Development/fantasy/docs/helio-issues.md`, issues #2 and #3). One root cause produces both reported symptoms, so they are fixed together here.

**Note — the field report's diagnosis is wrong and should not be followed.** It concludes "inference reads only the FIRST row" and suggests sampling N rows. That is not what the code does: `mergeObjects` (`SchemaInferenceEngine.scala:82`) already folds over **all** objects and unions their top-level keys. Sampling more rows would not fix either symptom.

### The actual bug (verified in code, 2026-08-28; re-verified against main @7972247c during Setup)

`mergeObjects` has two defects:

1. **Not recursive.** It merges only at the top level. When a key holds a nested object, the first row's object wins *wholesale* — its sub-keys are never unioned with later rows'. So `stats.rec` never becomes a column if row 0's `stats` happens to lack it, even though row 1 has it.
2. **First-value-wins, no type widening.** `case Some(_) => m` keeps the first non-null value, so `inferJsonType` sees only that value. A column whose first value is integral is typed `IntegerType` and every later fractional value silently truncates.

### Observed

* `.../projections/nfl/2026?...&position[]=QB&position[]=RB&position[]=WR&position[]=TE` ordered by `pts_ppr` returns Josh Allen (QB) first, Jahmyr Gibbs (RB) second. The DataType gets `stats.pass_yd`, `stats.pass_td`, `stats.cmp_pct`, `stats.rush_*` — but **no** `stats.rec`, `stats.rec_yd`, `stats.rec_td`, despite Gibbs having all three.
* The same URL with only `position[]=WR` (receiver first) *does* produce the full `rec_*` family.
* `stats.pts_half_ppr` infers as `float` in the mixed source but `integer` in the WR-only source, purely because the first WR's value was whole.

### Expected

The inferred schema is a function of the data, not of row ordering. A field present in any sampled row becomes a column; a column with any fractional sampled value is `float`.

### Consequences

Schema depends on result ordering, so it can **change between refreshes of the same URL**. For a PPR fantasy tool, `stats.rec` is the single most important column and it vanished on ordering alone. It also forced one source per position instead of one combined source.

## Scope

* Make the merge recurse into nested objects, unioning sub-keys at every level.
* Widen types across merged values rather than fixing on the first: any fractional value ⇒ `float`; mixed scalar types fall back to `string`; document and test the widening lattice.
* Preserve the existing null-tracking behaviour that marks a key nullable when any object has it null.
* Sanity-check the interaction with HEL-599 — both touch nested traversal, and they should share it rather than diverge.

## Inherited context from HEL-599 (merged 7972247c, PR #462)

* `JsonFlattener.leaves(obj): Seq[(String, JsValue)]` is now the single bounded traversal. Schema inference and row materialisation are both projections of it, so the field-name set and the column-key set are equal by construction.
* `mergeObjects` was deliberately left untouched — it is this ticket's territory. HEL-599's contract doc explicitly states HEL-858 "is expected to replace row-set-level merge with a union/widen over the leaf *paths* this produces, without needing any change to this traversal itself." Evaluate merging over PATHS rather than over raw objects; do not assume it, but it is the strictly easier position.
* HEL-599's final gate caught THIS EPIC'S OWN BUG one level inside its own fix: `leaves` returned duplicate-path pairs on colliding input like `{"a.b":1,"a":{"b":2}}`; the row projection folded into a `Map` and hid it, but the schema projection builds its field `Seq` straight from `leaves` and never folds, so a duplicate-named field reached the shipped DataType. The test passed ONLY because it asserted on a fold the schema side never performs. **Gate on AGREEMENT BETWEEN THE TWO PROJECTIONS under adversarial input, not on the correctness of either alone.**
* A green test over a fixture proves nothing if the fixture does not exercise the defect. HEL-599 re-fetched the live Sleeper endpoint to confirm fixture byte-equality rather than trusting the executor, and confirmed its symmetry test RED by an actual revert rather than asserting it would fail. That is the standard here too.

## Acceptance criteria

- [ ] A field present in any row of a heterogeneous array appears in the inferred schema regardless of its position — covered by a test whose rows are deliberately ordered so row 0 lacks the field.
- [ ] Inferring over the same rows in a different order produces an identical schema; a test asserts order-independence directly (e.g. by shuffling and comparing). **This is the central test — it exercises both defects at once, not an afterthought.**
- [ ] A numeric column whose values are mixed integral and fractional infers as `float`, and no truncation occurs on materialisation.
- [ ] The mixed-position Sleeper projections URL yields a DataType containing the full `stats.rec*` family, verified against the real endpoint.
- [ ] Nullability behaviour is unchanged for existing sources.

## Adversarial probe set required by the final gate

Colliding keys (`{"a.b":1,"a":{"b":2}}`), keys containing dots, unicode and empty-string keys, nulls, heterogeneous rows, depth at/over `JsonFlattener.MaxDepth`, and empty/non-object array elements. Schema-vs-rows agreement must hold on every one.
