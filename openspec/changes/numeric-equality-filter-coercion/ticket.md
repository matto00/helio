# HEL-889: filter `=` on any numeric column silently matches nothing (string compare against a Double)

## Description

Found during the HEL-857 exit-criterion rebuild, against production on `v0.7.6`. This is a live bug, not a local-only one.

Filtering the Sleeper projections feed for rookies:

```
filter {"combinator":"and","conditions":[{"field":"player.years_exp","operator":"=","value":"0"}]}
-> run succeeded, rowCount 0
```

The rows exist: 18 of the top 200 alone have `years_exp` 0 and `rookie_year` "2026".

Measured on the same pipeline, same field, same data, changing only the operator/value:

| condition | rows |
| -- | -- |
| `years_exp <= "0"` | 60 |
| `years_exp = "0"` | 0 |
| `years_exp = "0.0"` | 60 |

### Root cause (re-verified against main @ c70893be)

`backend/src/main/scala/com/helio/domain/steps/FilterStep.scala:95-98` — `=` and `!=` compare stringified values:

```scala
case "=" | "!=" =>
  val fieldStr = if (fieldVal == null) null else fieldVal.toString
  val valStr   = value.getOrElse("")
  if (operator == "=") fieldStr == valStr else fieldStr != valStr
```

Numeric row values are `Double` (`PipelineRowJson.jsValueToAny` maps `JsNumber` to `n.toDouble`), so `0` stringifies as `"0.0"`, which never equals the `"0"` a caller writes. The ordering operators immediately below (`>`, `>=`, `<`, `<=`) parse both sides with `toDouble`, so the two halves of the same function disagree.

`FilterCondition.value` is `Option[String]` on the wire, so a caller has no way to express "the number zero" other than as a string; the step is responsible for coercing, and does so for four operators out of six.

Note: the ticket cited the path as `services/pipeline/steps/FilterStep.scala`; the real path is `domain/steps/FilterStep.scala`. Line numbers and code are exact.

### Severity

Equality on a numeric column is one of the most common filters there is, the DataType advertises the field as `integer`, and the failure is completely silent: `status: "succeeded"`, `rowCount: 0`, no warning. A dashboard built on it shows an empty panel; a filter that is part of a larger pipeline silently removes every row and everything downstream computes over nothing. `"0.0"` working is not a workaround anyone would find, and it is not stable — it depends on the runtime numeric representation.

### Regression hazard (explicit)

The fix changes comparison semantics, so it can silently break string equality on numeric-looking string columns — `player_id` is a string of digits in this data, and `rookie_year` is a string. A naive "parse both sides as Double" fix would make `player_id = "007"` match the row whose id is `"7"`. This must be checked explicitly, not assumed away.

## Acceptance criteria

- [ ] `=` and `!=` coerce numerically when both sides parse as numbers, matching the ordering operators' existing behaviour. `years_exp = "0"` matches every row where the value is zero, whatever its runtime representation.
- [ ] String equality still works for genuinely non-numeric columns (`position = "WR"`), and is not broken by the numeric path.
- [ ] Numeric-looking *string* columns keep exact string-equality semantics: a row whose value is the String `"007"` must not match `= "7"`, and a row whose value is the String `"7"` must match `= "7"`.
- [ ] Mixed/edge cases are pinned by tests: integer-valued float (`0` vs `0.0` vs `"0"`), a numeric-looking string column where the caller means a string match, `null` on either side, and a value that parses as a number on one side only.
- [ ] Verified by measurement on materialised rows, with the red first: a test that fails on today's code for `= "0"` returning 0 rows. A test asserting only `<=` would pass today and prove nothing. The red must be recorded as a transcript in the executor's report.
- [ ] Audit every operator in `evalCondition` by enumeration (`is null`, `is not null`, `contains`, `=`, `!=`, `>`, `>=`, `<`, `<=`, fallthrough) for the same asymmetry, and state the decision for each in `design.md` — including `contains`, which also stringifies.
- [ ] Check whether any existing saved pipeline in production carries a numeric `=` filter that is currently matching nothing, and report what was found.
