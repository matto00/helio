## Context

See proposal.md — Why. The whole change is confined to `FilterStep.evalCondition`
(`backend/src/main/scala/com/helio/domain/steps/FilterStep.scala:90-114`).

Constraints that come from existing code, not from assumption:

- `FilterCondition.value` is `Option[String]` (`FilterStep.scala:15`). The caller has no typed channel.
- Row values are `Map[String, Any]` (`PipelineRowJson.Row`). Numbers arriving from JSON become `Double`
  (`PipelineRowJson.jsValueToAny`, `case JsNumber(n) => n.toDouble`); JSON strings stay `String`. Static
  and connector sources go through the same per-field conversion, so a "numeric-looking string column"
  is genuinely a `String` at runtime and is distinguishable from a number.
- `PipelineRowJson.toDouble` already exists as the shared best-effort coercion, and already discriminates
  by runtime type — `case s: String => s.toDoubleOption` is a *separate* case from the numeric cases.
  That existing shape is what makes the type-aware rule below cheap to express.

## Goals / Non-Goals

**Goals**: numeric `=`/`!=` for numeric row values; byte-identical behaviour for every other input.

**Non-Goals**: symmetric two-sided parsing; any wire or schema change; touching any other step or operator.

## Decisions

**D1 — Coerce on the row value's runtime type, not on "both sides parse".**
The condition value is *always* a string, so "both sides parse as numbers" would make the row value's type
irrelevant and would silently convert every numeric-looking string column to numeric equality. That is the
regression hazard called out in the ticket and it is real in this dataset: `player_id` is a digit string and
`rookie_year` is a string. Under a both-sides rule, `player_id = "7"` would start matching the row whose id
is `"007"`, and `rookie_year = "2026.0"` would start matching `"2026"` — a silent, invisible widening of a
filter users already rely on. So: numeric comparison applies **only** when `fieldVal` is one of
`Int | Long | Float | Double | BigDecimal | java.math.BigDecimal` *and* the condition value parses as a
Double. Every other combination falls through to today's exact string comparison, unchanged.

*Alternative considered*: use `PipelineRowJson.toDouble` on both sides (symmetric). Rejected for exactly the
above; `toDouble`'s `String` case is right for the ordering operators (where there is no string ordering
fallback and a coercion failure already means no-match) but wrong here, where a correct string answer exists.

*Alternative considered*: infer intent from the DataType's declared field type. Rejected — `evalCondition`
has no schema in scope, the declared type is advisory and frequently drifts from the materialised value
(`pipeline-schema-drift`), and it would couple a pure row-level predicate to the type registry.

**D2 — `!=` is the exact negation of `=` for non-null row values, and null semantics are preserved
byte-for-byte.** Today `fieldStr` is `null` for a null row value, so `null == "0"` is false and
`null != "0"` is true: a null row value fails `=` and passes `!=`. This is what the archived
`pipeline-filter-op` spec already asserts ("Missing field treated as null … no rows are returned"). The new
code must reproduce it exactly rather than incidentally; it is pinned by two scenarios in the spec delta.
Note the asymmetry is deliberate SQL-unlike behaviour that already ships — this change does not relitigate it.

**D3 — Empty condition value.** `value.getOrElse("")` today makes an omitted `value` compare against `""`.
`"".toDoubleOption` is `None`, so an omitted value always falls to the string path and behaves exactly as
today. No special case needed; asserted rather than assumed.

**D4 — Operator audit, by enumeration of the `match` in `evalCondition` (nine arms, no others):**

| arm | stringifies? | decision |
| -- | -- | -- |
| `is null` | n/a | unchanged — pure null test, no comparison |
| `is not null` | n/a | unchanged — same |
| `contains` | yes | **unchanged, deliberately.** `contains` is a substring predicate; substrings are a property of text, not of numbers. There is no numeric reading of "contains". The one visible consequence — a `Double` 10 rendering as `"10.0"`, so `contains "0"` is true — is inherent to textual matching over a numeric column and is pinned by a scenario rather than left implicit. |
| `=` | yes | **changed** per D1 |
| `!=` | yes | **changed** per D1/D2 |
| `>` `>=` `<` `<=` | no — parse both sides | unchanged. Note these *do* use the symmetric rule D1 rejects, so a numeric-looking string column is ordered numerically. That is pre-existing and defensible (there is no meaningful string-ordering fallback for `>`), and changing it is out of scope; recorded here so the divergence is a stated decision, not an oversight. |
| fallthrough `case _` | n/a | unchanged — unknown operator returns false |

**D5 — Where the numeric test lives.** A small private helper in `FilterStep` (`numericFieldValue: Any =>
Option[Double]`), not an addition to `PipelineRowJson.toDouble`. `toDouble` is shared by the sort and
aggregate paths, which want the string-parsing case; narrowing it would change them. Keeping the stricter
rule local keeps the blast radius to this one operator pair.

## Risks / Trade-offs

- **Saved pipelines change behaviour.** A numeric `=` filter that currently returns nothing will start
  returning rows. → That is the fix, but it is a live behaviour change, so the survey (tasks.md) reports
  which saved pipelines are affected before delivery rather than discovering it in production.
- **A column that is numeric in some rows and a string in others** now compares per-row: a `Double` 7 row
  matches `= "7"` while a `String "7"` row also matches (its exact string form equals `"7"`), but a
  `String "007"` row does not. → Acceptable and pinned by scenarios; both readings are individually correct
  for their row, and no row silently *stops* matching relative to today.
- **`Double` precision.** `= "0.1"` against a stored `0.1` compares two `Double`s parsed from decimal text
  by the same routine, so it is exact for values that round-trip; it is not a general fix for float equality.
  → Out of scope; not regressed relative to today (today it does not match at all).

## Migration Plan

Pure code change; no migration, no data backfill, no config. Rollback is a revert of the single commit.

## Planner Notes

- Self-approved: helper placement (D5), preserving the pre-existing null asymmetry rather than "fixing" it
  (D2), and leaving the ordering operators' symmetric coercion alone (D4).
- The ticket's cited path (`services/pipeline/steps/FilterStep.scala`) is stale; the file is at
  `domain/steps/FilterStep.scala`. Line numbers and quoted code are exact. Root cause re-verified on `main`
  @ c70893be before planning; see the persisted `premise-validation.md`.
