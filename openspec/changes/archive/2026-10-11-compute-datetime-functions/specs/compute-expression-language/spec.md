## ADDED Requirements

### Requirement: Date/time functions compute timestamp differences, truncation, and day offsets in UTC
The strict compute expression grammar SHALL provide `seconds_between(end, start)`, `date_trunc(unit, ts)`, and
`add_days(ts, n)`. Every timestamp argument SHALL be read with the shared timestamp parser (the
`timestamp-value-parsing` capability), interpreted in UTC. All three SHALL be null-propagating: a `null` argument
SHALL yield `null`. A timestamp argument that the shared parser does not accept SHALL yield `null` for that row,
never failing the run.
- `seconds_between(end, start)` SHALL return `end - start` as a number of seconds, including any fractional part,
  unrounded. The result is negative when `end` precedes `start`.
- `date_trunc(unit, ts)` SHALL floor `ts` to the start of the `unit` bucket in UTC. `unit` SHALL be a string literal,
  one of `second`, `minute`, `hour`, `day`, `week` (floors to the Monday of the ISO-8601 week), `month`, `quarter`,
  or `year`. A `unit` that is not a string literal, or a literal outside that set, SHALL be a parse error naming the
  supported units. This includes a bare identifier such as `date_trunc(day, $ts)`, which SHALL report the units
  message rather than the `$`-prefix message, and SHALL NOT be retried under the legacy grammar.
- `add_days(ts, n)` SHALL return `ts` plus `n` × 86400 seconds exactly, whole or fractional, with no calendar or DST
  adjustment. A non-numeric `n` SHALL be an evaluation type error, so the row's value is `null`. A result outside
  the representable instant range SHALL be `null`.
- `date_trunc` and `add_days` SHALL return an ISO-8601 UTC instant string ending in `Z` (for example
  `2026-07-01T00:00:00Z`). Fractional seconds SHALL be printed only when non-zero.
- No `now()`/`today()` function SHALL exist. The `-` operator SHALL remain numeric-only, so subtracting two
  timestamp strings is a type error (row `null`), exactly as before.

#### Scenario: seconds_between of two ISO timestamps
- **WHEN** `seconds_between($started_at, $created_at)` is evaluated against `{"started_at": "2026-07-01T12:01:30Z", "created_at": "2026-07-01T12:00:00Z"}`
- **THEN** the result is the JSON number `90`

#### Scenario: seconds_between keeps fractional seconds and sign
- **WHEN** `seconds_between("2026-07-01T00:00:00Z", "2026-07-01T00:00:01.5Z")` is evaluated
- **THEN** the result is `-1.5`

#### Scenario: offsets are honored and tz-less values are UTC
- **WHEN** `seconds_between("2026-07-01T12:00:00+02:00", "2026-07-01 10:00:00")` is evaluated
- **THEN** the result is `0`

#### Scenario: mixed bare date and timestamp
- **WHEN** `seconds_between("2026-07-02T06:00:00Z", "2026-07-02")` is evaluated
- **THEN** the result is `21600` (a bare date is midnight UTC)

#### Scenario: leap day is counted
- **WHEN** `seconds_between("2024-03-01", "2024-02-28")` is evaluated
- **THEN** the result is `172800`

#### Scenario: no DST adjustment across a US DST transition
- **WHEN** `seconds_between("2026-03-09T00:00:00Z", "2026-03-08T00:00:00Z")` is evaluated
- **THEN** the result is `86400`

#### Scenario: null or unparseable input yields null
- **WHEN** `seconds_between($a, $b)` is evaluated against `{"a": null, "b": "2026-07-01T00:00:00Z"}`, and separately against `{"a": "not a date", "b": "2026-07-01T00:00:00Z"}`
- **THEN** both results are `null`, and a compute step running over those rows completes successfully

#### Scenario: date_trunc floors in UTC
- **WHEN** `date_trunc("month", "2024-02-29T17:45:12Z")` is evaluated, and separately `date_trunc("week", "2026-03-19T08:00:00Z")` and `date_trunc("hour", "2026-07-01T12:34:56.789+01:00")`
- **THEN** the results are `"2024-02-01T00:00:00Z"`, `"2026-03-16T00:00:00Z"` and `"2026-07-01T11:00:00Z"`

#### Scenario: date_trunc rejects an unknown or non-literal unit at parse time
- **WHEN** `date_trunc("fortnight", $ts)`, `date_trunc($unit, $ts)` or `date_trunc(day, $ts)` is validated, or checked by the write-path parseability check
- **THEN** each fails with a parse error naming the supported units (never the `$`-prefix message)

#### Scenario: add_days crosses a leap day and accepts fractions
- **WHEN** `add_days("2024-02-28", 1)` is evaluated, and separately `add_days("2026-07-01T00:00:00Z", 0.5)`
- **THEN** the results are `"2024-02-29T00:00:00Z"` and `"2026-07-01T12:00:00Z"`

#### Scenario: add_days handles large shifts and nulls unrepresentable ones
- **WHEN** `add_days("2026-07-01", 1000000)` is evaluated, and separately `add_days("2026-07-01", 1000000000000000)`
- **THEN** the results are `"4764-05-28T00:00:00Z"` and `null`

#### Scenario: add_days with a text day count nulls the row
- **WHEN** `add_days($ts, $n)` is evaluated against `{"ts": "2026-07-01", "n": "3"}`
- **THEN** the row's computed value is `null`

## MODIFIED Requirements

### Requirement: Output type can be inferred from the expression AST
`ExpressionEvaluator.inferType` SHALL compute a result type for a given expression and a map of input field name →
type. The result is a canonical wire value: `"float"`, `"string"` or `"timestamp"`, or, for `coalesce` of same-typed
arguments, that shared input type. It SHALL walk the same AST used for parsing, without evaluating against actual
row data.
- Field references resolve via the supplied type map.
- Numeric literals and operators infer `"float"`.
- String literals, `concat`, `substring`, `lower` and `upper` infer `"string"`.
- `length`, `floor`, `ceil`, `round`, `mod`, `abs` and `seconds_between` infer `"float"`.
- `date_trunc` and `add_days` infer `"timestamp"`.
- `+` infers `"string"` if either operand infers `"string"` or `"timestamp"` (a timestamp value is text at evaluation
  time, so `+` concatenates); otherwise it infers `"float"`.
- For every numeric function and every date/time function, the inferred type SHALL agree with the value the same
  expression produces at run time: a JSON number for `"float"`, a JSON string for `"timestamp"`.
- `coalesce` SHALL infer the common type of its arguments:
  - if every argument infers the same type, that type;
  - otherwise, if every argument infers a numeric type (`"integer"` or `"float"`), `"float"`;
  - otherwise, if no argument infers a numeric type, `"string"`.
  - If at least one argument infers a numeric type and at least one infers a non-numeric type, inference SHALL fail
    with an error naming `coalesce`, the argument types, and the `concat(...)` workaround.

#### Scenario: Arithmetic expression infers number
- **WHEN** `inferType` is called with `$price * $qty` and `{"price": "float", "qty": "float"}`
- **THEN** it returns `Right("float")`

#### Scenario: Concatenation expression infers string
- **WHEN** `inferType` is called with `concat($first_name, " ", $last_name)` and
  `{"first_name": "string", "last_name": "string"}`
- **THEN** it returns `Right("string")`

#### Scenario: Numeric function infers float and evaluates to a number
- **WHEN** `inferType` is called with `round($rate * 100, 1)` and `{"rate": "float"}`
- **THEN** it returns `Right("float")`
- **AND** evaluating the same expression against `{"rate": 0.8734}` yields the JSON number `87.3`

#### Scenario: Unresolvable field reference is an inference error
- **WHEN** `inferType` is called with `$missing * 2` and `{}`
- **THEN** it returns `Left(...)` describing the unknown field

#### Scenario: coalesce infers the common type of its arguments
- **WHEN** `inferType` is called with `coalesce($first, "")` and `{"first": "string"}`
- **THEN** it returns `Right("string")`
- **AND** `coalesce($n, 0)` with `{"n": "integer"}` returns `Right("float")`

#### Scenario: coalesce of a numeric and a text argument is an inference error
- **WHEN** `inferType` is called with `coalesce($n, "n/a")` and `{"n": "float"}`
- **THEN** it returns `Left(...)` naming `coalesce` and suggesting `concat(...)`
- **AND** `coalesce(concat($n), "n/a")` with the same types returns `Right("string")`

#### Scenario: date/time functions infer float and timestamp, matching evaluation
- **WHEN** `inferType` is called with `seconds_between($end, $start)`, `date_trunc("day", $end)` and `add_days($end, 1)`, each with `{"end": "timestamp", "start": "timestamp"}`
- **THEN** they return `Right("float")`, `Right("timestamp")` and `Right("timestamp")`
- **AND** evaluating them against ISO timestamp strings yields a JSON number, a JSON string and a JSON string respectively

#### Scenario: plus with a timestamp operand infers string
- **WHEN** `inferType` is called with `$ts + 1` and `{"ts": "timestamp"}`
- **THEN** it returns `Right("string")`
- **AND** evaluating it against `{"ts": "2026-07-01"}` yields the JSON string `"2026-07-011"`
