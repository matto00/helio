## MODIFIED Requirements

### Requirement: Output type can be inferred from the expression AST
`ExpressionEvaluator.inferType` SHALL compute a result type for a given expression and a map of input field name →
type. The result is a canonical wire value: `"float"`, `"string"`, `"timestamp"` or `"boolean"`, or, for `coalesce`
or `if` of same-typed values, that shared input type. It SHALL walk the same AST used for parsing, without evaluating
against actual row data.
- Field references resolve via the supplied type map.
- Numeric literals and operators infer `"float"`.
- String literals, `concat`, `substring`, `lower` and `upper` infer `"string"`.
- `length`, `floor`, `ceil`, `round`, `mod`, `abs` and `seconds_between` infer `"float"`.
- `date_trunc` and `add_days` infer `"timestamp"`.
- `true`, `false`, comparisons, `and`, `or` and `not` infer `"boolean"`.
- `+` infers `"string"` if either operand infers `"string"`, `"string-body"`, `"timestamp"` or `"boolean"` (each is
  concatenated as text); otherwise it infers `"float"`.
- A comparison whose operands infer different kinds (numeric `"integer"`/`"float"`; text `"string"`/`"string-body"`/
  `"timestamp"`; `"boolean"`), or an ordering comparison of booleans, SHALL fail inference with an error naming the
  operator and both operand types.
- A boolean-valued sub-expression other than a bare field reference used as an operand of `-`, `*`, `/`, unary `-` or
  a numeric function SHALL fail inference with an error suggesting `if(cond, 1, 0)`.
- An `and`/`or`/`not` operand, or an `if` condition, that does not infer `"boolean"` SHALL fail inference with an
  error naming the operator or `if`.
- For every numeric function, date/time function, comparison, boolean operator and `if`, the inferred type SHALL agree
  with the value the same expression produces at run time: a JSON number for `"float"`, a JSON string for
  `"timestamp"` or `"string"`, a JSON boolean for `"boolean"`.
- `coalesce` arguments and `if`'s two branches SHALL infer their common type:
  - if every value infers the same type, that type;
  - otherwise, if every value infers a numeric type (`"integer"` or `"float"`), `"float"`;
  - otherwise, if no value infers a numeric type and none infers `"boolean"`, `"string"`.
  - Any other mix (numeric with non-numeric, or boolean with non-boolean) SHALL fail inference with an error naming
    `coalesce` or `if` and the types; for `coalesce` of numeric and text it SHALL suggest the `concat(...)` workaround.
- On the pipeline `compute` step every inference failure above SHALL be reported at analyze time as that step's
  validation error; saving the step SHALL remain governed by parse validity alone.

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

#### Scenario: comparison and boolean operators infer boolean, matching evaluation
- **WHEN** `inferType` is called with `$amount > 100 and not $closed` and `{"amount": "float", "closed": "boolean"}`
- **THEN** it returns `Right("boolean")`
- **AND** evaluating it against `{"amount": 150, "closed": false}` yields the JSON boolean `true`

#### Scenario: a boolean column referenced alone infers and evaluates as boolean
- **WHEN** `inferType` is called with `$flag` and `{"flag": "boolean"}`
- **THEN** it returns `Right("boolean")` and evaluating it against `{"flag": true}` yields the JSON boolean `true`

#### Scenario: plus with a boolean operand infers string
- **WHEN** `inferType` is called with `$flag + 1` and `{"flag": "boolean"}`
- **THEN** it returns `Right("string")`

#### Scenario: if infers the common type of its branches
- **WHEN** `inferType` is called with `if($ok, $n, 0)` and `{"ok": "boolean", "n": "integer"}`
- **THEN** it returns `Right("float")`
- **AND** `if($ok, $n, "none")` returns `Left(...)` naming `if`

#### Scenario: mismatched comparison is an analyze-time error, not a save or run block
- **WHEN** a pipeline `compute` step has expression `$n = "5"` where `n` is a float field
- **THEN** analyze reports a validation error on that step naming `=` and both types
- **AND** saving the step succeeds

#### Scenario: string-body plus a number infers string
- **WHEN** the output type of `$body + 1` is inferred with `body` declared `string-body`
- **THEN** the inferred type is `string`

## ADDED Requirements

### Requirement: Expression nesting depth is bounded
The compute expression parsers SHALL reject an expression whose bracket, function-call, unary `-` or `not` nesting
exceeds 100 levels, and SHALL reject an expression whose parsed tree is deeper than 200 levels (tree depth is the
number of nodes on the longest root-to-leaf path, a lone literal being depth 1; for example `1` followed by 200
repetitions of `+1` has depth 201), each with a parse error that names the limit. Both limits SHALL apply on every
path that parses an expression, including the legacy bare-identifier fallback. Each such error SHALL be reported like
any other parse error: on save validation, on validate-expression, and as a `null` result for every row when such an
expression is run. No expression input of any length SHALL make parsing, validation, type inference, warning analysis
or evaluation throw a stack overflow or any other exception. Expressions within both limits SHALL parse and evaluate
exactly as before.

#### Scenario: a long unary-minus chain is a parse error
- **WHEN** an expression of 10000 consecutive `-` characters followed by `1` is validated
- **THEN** validation fails with a parse error naming the nesting limit, and no exception escapes

#### Scenario: deeply nested brackets are a parse error
- **WHEN** an expression of 10000 `(` characters, `1`, then 10000 `)` characters is validated
- **THEN** validation fails with a parse error naming the nesting limit

#### Scenario: deep brackets on the legacy fallback are a parse error
- **WHEN** `x + ` followed by 10000 `(` characters, `1` and 10000 `)` characters is validated, and is compiled for a run
- **THEN** both fail with a parse error naming the nesting limit, and no exception escapes

#### Scenario: a long flat operator chain is a parse error
- **WHEN** `1` followed by 10000 repetitions of `+1` is validated, has its type inferred, and is evaluated
- **THEN** each fails with a parse error naming the tree-depth limit, and no exception escapes

#### Scenario: nesting at the limits still works
- **WHEN** an expression with exactly 100 nested unary minus operators before `1`, and `1` followed by 199 repetitions of `+1` (depth 200), are evaluated
- **THEN** they parse and evaluate to `1` and `200`

#### Scenario: one level past the tree limit is rejected
- **WHEN** `1` followed by 200 repetitions of `+1` (depth 201) is validated
- **THEN** validation fails with a parse error naming the tree-depth limit
