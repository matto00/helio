## Why

`filter` with `=` on a numeric column matches nothing. Row values arriving from JSON are stored as
`Double` (`PipelineRowJson.jsValueToAny` maps `JsNumber` to `n.toDouble`), and the `=`/`!=` branch of
`FilterStep.evalCondition` compares `fieldVal.toString` against the caller's string — so a stored `0`
stringifies to `"0.0"` and never equals the `"0"` a caller can express through the wire's
`Option[String]` value. The ordering operators two lines below already coerce both sides with
`toDouble`, so the same function disagrees with itself. The failure is silent: the run succeeds with
`rowCount 0`. Measured on production `v0.7.6`: `years_exp <= "0"` returns 60 rows, `years_exp = "0"`
returns 0, `years_exp = "0.0"` returns 60.

## What Changes

- `=` and `!=` in `FilterStep.evalCondition` compare numerically when the **row value is a numeric
  runtime type** (`Int`/`Long`/`Float`/`Double`/`BigDecimal`) and the condition value parses as a
  number. Otherwise the existing exact string comparison is kept, unchanged.
- **Not** a symmetric "parse both sides" rule: a row value that is a `String` keeps exact string
  equality, so numeric-looking string columns (`player_id`, `rookie_year`) are unaffected — `"007"`
  still does not match `= "7"`.
- Existing `null` semantics for `=`/`!=` are preserved byte-for-byte.
- Every operator in `evalCondition` is audited by enumeration and the decision recorded in `design.md`;
  `contains`, `is null`, `is not null` and the ordering operators are left unchanged, deliberately.
- Tests pin the behaviour on materialised rows, with a recorded red run first.
- A read-only survey of saved pipelines reports which currently carry an affected numeric `=` filter.

### Non-goals

- No wire-shape change: `FilterCondition.value` stays `Option[String]`.
- No typed-operand or schema-aware filter model.
- No change to any other step, to `PipelineRowJson`, or to the analyze/inference path.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-filter-op`: the `=`/`!=` requirement gains numeric coercion when the row value is numeric,
  with exact string equality retained for string-typed row values and unchanged null semantics.

## Impact

- `backend/src/main/scala/com/helio/domain/steps/FilterStep.scala` (`evalCondition` only).
- Backend test suite for the filter step.
- Behaviour change for any saved pipeline whose numeric `=`/`!=` filter currently matches nothing —
  those begin returning rows, which is the intended fix; surveyed and reported at delivery.
