# compute-expression-language Specification

## Purpose
Defines the shared expression grammar (literals, `$`-prefixed column references, operators,
string functions, type-coercion rules) that both the pipeline Compute step's engine and its
step-card UI implement as a single documented contract.

## Requirements

### Requirement: Column references require a `$` prefix
`ExpressionEvaluator` SHALL treat `$` followed by an identifier as a field reference. An identifier
SHALL match `[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*` — that is, one or more `_`/alphanumeric
segments joined by interior dots. A dot SHALL be admitted only between two identifier characters: a
reference with a leading, trailing, or doubled dot SHALL be a parse error. A bare identifier not
preceded by `$` and not immediately followed by `(` (a function call, see below) SHALL be a parse
error, except the reserved words `and`, `or`, `not`, `true` and `false` (case-insensitive), which are operators or
literals per the boolean-operators requirement, also when immediately followed by `(`. Numeric constants and double-quoted string literals are unaffected by this requirement.

A dotted reference SHALL name exactly one column whose literal name contains those dots. The
evaluator SHALL resolve it by exact match against the row's keys and SHALL NOT split it into
segments, traverse it as a path into a nested value, or fall back to any shorter prefix. This is
well-defined because rows reaching the evaluator are already flat: nested JSON is flattened to
dotted column names upstream, and a literal dotted key colliding with a nested path is deduplicated
to a single column at that point, so no nested structure and no competing interpretation survives to
evaluation time.

When a reference does not match any column, the resulting error SHALL name the unresolved reference
and SHALL distinguish the dotted case, so that a caller who supplied a dotted reference is directed
to check the flattened column name rather than assume path traversal was attempted.

#### Scenario: `$`-prefixed identifier resolves to a field reference
- **WHEN** the expression `$price * $qty` is evaluated against a row `{"price": 2, "qty": 3}`
- **THEN** the result is `6`

#### Scenario: Dotted reference resolves to the flattened column of that exact name
- **WHEN** the expression `$stats.pts_ppr * 2` is evaluated against a row `{"stats.pts_ppr": 12}`
- **THEN** the result is `24`

#### Scenario: A dotted reference is not split into a prefix when only the prefix exists
- **WHEN** the expression `$stats.pts_ppr` is evaluated against a row `{"stats": 5}`
- **THEN** evaluation returns an unknown-field error naming `stats.pts_ppr`, and does not return `5`

#### Scenario: A literal dotted column and a nested path resolve to one and the same column
- **WHEN** a source row `{"a.b": 1, "a": {"b": 2}}` is flattened and the expression `$a.b` is
  evaluated against the resulting row
- **THEN** exactly one column `a.b` exists, and the expression resolves to that column's single
  deduplicated value rather than erroring on ambiguity

#### Scenario: Trailing or doubled dot in a reference is a parse error naming an incomplete reference
- **WHEN** the expression `$stats.` (or `$a..b`) is validated
- **THEN** validation returns a parse error whose message names the failure as an incomplete
  dotted column reference and does NOT describe it as an invalid number literal — the leftover
  dot follows a `$`-reference, not a numeric constant, and the message must not point the caller
  at the wrong construct

#### Scenario: Bare identifier without `$` is a parse error
- **WHEN** the expression `price * qty` is validated
- **THEN** validation returns an error indicating column references require a `$` prefix

#### Scenario: A dot does not become an operator on bare identifiers
- **WHEN** the expression `stats.pts_ppr` is validated
- **THEN** validation returns a parse error, not a successful parse — the bare-identifier scan
  is unchanged by this requirement (it does not admit dots), so tokenization fails on the `.`
  before the parser's `$`-prefix check is even reached; this is a pre-existing, untouched
  failure mode, distinct from the literal `$`-prefix-required message returned for a
  dot-free bare identifier like `price * qty`

#### Scenario: Numeric constant does not require `$`
- **WHEN** the expression `$amount * 1.05` is evaluated against a row `{"amount": 100}`
- **THEN** the result is `105`

#### Scenario: A leading-dot number literal is unaffected
- **WHEN** the expression `$amount * .5` is evaluated against a row `{"amount": 100}`
- **THEN** the result is `50`

#### Scenario: String literal does not require `$`
- **WHEN** the expression `$first_name + " " + $last_name` is evaluated against a row
  `{"first_name": "Ada", "last_name": "Lovelace"}`
- **THEN** the result is `"Ada Lovelace"`

#### Scenario: reserved words are not column references
- **WHEN** `true`, `not($a)` and `$a AND $b` are validated against fields `a`, `b`
- **THEN** each validates (a literal, a `not` operator and an `and` operator), none fails with the `$`-prefix error

### Requirement: Function-call syntax for string operations
`ExpressionEvaluator` SHALL support function-call syntax `name(arg1, arg2, ...)` for a fixed set
of functions: the string functions `concat` (variadic, arity ≥ 1), `substring` (arity 3: value, start, end —
0-indexed, end exclusive), `lower` (arity 1), `upper` (arity 1), and `length` (arity 1), and the numeric functions
`floor` (arity 1), `ceil` (arity 1), `abs` (arity 1), `round` (arity 1 or 2), and `mod` (arity 2), the
null-handling function `coalesce` (variadic, arity ≥ 2), and the conditional function `if` (arity 3; see the `if`
requirement). Function arguments are themselves expressions (literals, `$refs`, comparisons, boolean expressions, or
nested calls). An unknown function name, or a call with the wrong arity, SHALL be a parse error. The unknown-function
error message SHALL name the unrecognized function and list every supported function name. A boolean value given as
the text argument of `substring`, `lower`, `upper` or `length` SHALL be read as its text `true`/`false`, so these
functions return the same results on boolean columns as before booleans existed.

#### Scenario: concat joins multiple arguments as strings
- **WHEN** the expression `concat($first_name, " ", $last_name)` is evaluated against
  `{"first_name": "Ada", "last_name": "Lovelace"}`
- **THEN** the result is `"Ada Lovelace"`

#### Scenario: substring extracts a range
- **WHEN** the expression `substring($sku, 0, 3)` is evaluated against `{"sku": "ABC-1234"}`
- **THEN** the result is `"ABC"`

#### Scenario: substring clamps an out-of-range end index rather than erroring
- **WHEN** the expression `substring($sku, 0, 999)` is evaluated against `{"sku": "AB"}`
- **THEN** the result is `"AB"` (no error)

#### Scenario: lower and upper change case
- **WHEN** the expression `upper($code)` is evaluated against `{"code": "ab12"}`
- **THEN** the result is `"AB12"`

#### Scenario: length returns the character count as a number
- **WHEN** the expression `length($name)` is evaluated against `{"name": "Ada"}`
- **THEN** the result is `3`

#### Scenario: string functions read a boolean column as its text
- **WHEN** `length($flag)`, `upper($flag)` and `substring($flag, 0, 1)` are evaluated against `{"flag": true}`
- **THEN** the results are `4`, `"TRUE"` and `"t"`

#### Scenario: Unknown function name is a parse error
- **WHEN** the expression `reverse($name)` is validated
- **THEN** validation returns an error indicating `reverse` is not a recognized function
- **AND** the error lists the supported functions, including `floor`, `ceil`, `round`, `mod`, `abs`, `coalesce` and
  `if`

#### Scenario: Wrong arity is a parse error
- **WHEN** the expression `substring($name, 0)` is validated
- **THEN** validation returns an error indicating `substring` requires 3 arguments

#### Scenario: Wrong arity for a numeric function is a parse error
- **WHEN** the expression `mod($a)` or `round($a, 1, 2)` is validated
- **THEN** validation returns an error naming the function and its required arity

#### Scenario: coalesce with fewer than two arguments is a parse error
- **WHEN** the expression `coalesce($a)` or `coalesce()` is validated
- **THEN** validation returns the error `coalesce requires at least 2 arguments`

### Requirement: Numeric operators are type-strict; `+` is coercion-permissive
`-`, `*`, and `/` SHALL require both operands to evaluate to numbers; a non-numeric operand (a string or a boolean,
after field/function resolution) SHALL be an evaluation-time `TypeError`. `+` SHALL remain permissive: if either
operand is a string or a boolean, each operand is coerced to its text (a boolean to `true`/`false`, a number to its
string representation) and the result is string concatenation; if both are numbers, the result is numeric addition.
Function arguments follow the same per-function type rules as their own arity/type requirements (e.g. `substring`'s
first argument must be a string or a boolean read as text). A boolean given where a date/time function expects a
timestamp SHALL be "not a timestamp" (that row's result is `null`), never a run failure.

#### Scenario: Subtracting a string field is a type error
- **WHEN** the expression `$amount - $label` is evaluated against `{"amount": 10, "label": "x"}`
- **THEN** the row's computed field value is `null` (evaluation error, not an exception)

#### Scenario: Addition coerces a number to string when the other operand is a string
- **WHEN** the expression `"Total: " + $amount` is evaluated against `{"amount": 5}`
- **THEN** the result is `"Total: 5"`

#### Scenario: Addition of two numbers stays numeric
- **WHEN** the expression `$a + $b` is evaluated against `{"a": 1, "b": 2}`
- **THEN** the result is `3` (not `"12"`)

#### Scenario: Addition with a boolean concatenates
- **WHEN** `$flag + 1` and `$flag + $flag` are evaluated against `{"flag": true}`
- **THEN** the results are `"true1"` and `"truetrue"`

#### Scenario: a boolean timestamp argument nulls the row, never fails the run
- **WHEN** a compute step with `seconds_between($flag, $ts)` runs over `{"flag": true, "ts": "2026-01-01"}`
- **THEN** that row's value is `null` and the run succeeds

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

### Requirement: Dotted references are usable on every expression surface
Every surface that evaluates or validates an expression SHALL accept a dotted column reference on
the same terms, because they share one grammar. This covers row evaluation for the pipeline compute
step and for source computed fields, strict validation and result-type inference for live step-card
feedback, and legacy-tolerant validation for data-type computed fields and patch-set preview.
Admitting dots SHALL NOT alter the legacy bare-identifier fallback: an expression that fails strict
parsing for any reason other than a missing `$` prefix SHALL still not be retried against the legacy
grammar.

#### Scenario: Strict validation accepts a dotted reference present in the schema
- **WHEN** `$stats.pts_ppr + 1` is validated against the field names `["stats.pts_ppr"]`
- **THEN** validation succeeds

#### Scenario: Type inference resolves a dotted reference's type from the schema
- **WHEN** the result type of `$stats.pts_ppr * 2` is inferred against the field types
  `{"stats.pts_ppr": "number"}`
- **THEN** the inferred type is `"number"`

#### Scenario: Legacy-tolerant validation accepts a dotted reference
- **WHEN** `$stats.pts_ppr` is validated tolerantly against the field names `["stats.pts_ppr"]`
- **THEN** validation succeeds

#### Scenario: Source computed fields accept a dotted reference
- **WHEN** a source computed field with expression `$stats.pts_ppr * 2` is applied to a flattened
  row `{"stats.pts_ppr": 12}`
- **THEN** the computed value is `24` and no evaluation error is reported

#### Scenario: A legacy bare-identifier expression still runs unchanged
- **WHEN** the stored expression `price * quantity` is evaluated against a row
  `{"price": 2, "quantity": 3}`
- **THEN** the result is `6`

### Requirement: Key-addressed steps continue to accept dotted column names
Steps that address columns by name through configuration rather than through the expression grammar
SHALL continue to accept dotted column names unchanged. This SHALL remain true for the filter step,
whose conditions name a column directly and resolve it by exact key match.

#### Scenario: A filter condition matches on a dotted column
- **WHEN** a filter condition on field `stats.pts_ppr` with operator `>` and value `10` is applied
  to rows `[{"stats.pts_ppr": 12}, {"stats.pts_ppr": 4}]`
- **THEN** only the row whose `stats.pts_ppr` is `12` is retained

### Requirement: Numeric functions have defined rounding, sign, and null semantics
The numeric functions SHALL require numeric arguments; a non-numeric argument (including a numeric-looking string
such as `"3.7"`) SHALL be an evaluation-time type error, yielding `null` for that row, consistent with the strict
`-`/`*`/`/` operators. If any argument is `null`, the result SHALL be `null`. `floor` SHALL round toward negative
infinity and `ceil` toward positive infinity. `abs` SHALL return the absolute value. `round(x)` SHALL equal
`round(x, 0)`; `round(x, digits)` SHALL round to `digits` decimal places with ties rounded away from zero, where
`digits` MUST be a whole number (negative values round to tens, hundreds, …) and a fractional `digits` SHALL be a type
error. `mod(a, b)` SHALL return the floored remainder, whose sign follows the divisor `b`; `mod(a, 0)` SHALL be a
division-by-zero evaluation error, yielding `null` for that row, consistent with `/`. No numeric function result
SHALL be negative zero.

#### Scenario: floor and ceil on negatives
- **WHEN** `floor($x)` and `ceil($x)` are evaluated against `{"x": -2.5}`
- **THEN** the results are `-3` and `-2`

#### Scenario: abs of a negative value
- **WHEN** `abs($x)` is evaluated against `{"x": -4.25}`
- **THEN** the result is `4.25`

#### Scenario: round ties away from zero
- **WHEN** `round($x)` is evaluated against `{"x": 2.5}` and against `{"x": -2.5}`
- **THEN** the results are `3` and `-3`

#### Scenario: round to digits uses the decimal value
- **WHEN** `round($x, 2)` is evaluated against `{"x": 2.675}`
- **THEN** the result is `2.68`

#### Scenario: round with negative digits
- **WHEN** `round($x, -2)` is evaluated against `{"x": 1234}`
- **THEN** the result is `1200`

#### Scenario: round with fractional digits is a type error
- **WHEN** `round($x, 1.5)` is evaluated against `{"x": 3.14159}`
- **THEN** the row's computed field value is `null`

#### Scenario: mod sign follows the divisor
- **WHEN** `mod($a, 3)` is evaluated against `{"a": -7}`, and `mod($a, -3)` against `{"a": 7}`
- **THEN** the results are `2` and `-2`

#### Scenario: mod by zero yields null
- **WHEN** `mod($a, 0)` is evaluated against `{"a": 7}`
- **THEN** the row's computed field value is `null` (division by zero, not an exception)

#### Scenario: null input propagates
- **WHEN** `floor($x)`, `round($x, 1)`, and `mod($x, 2)` are evaluated against `{"x": null}`
- **THEN** each result is `null`

#### Scenario: numeric string argument is a type error
- **WHEN** `floor($x)` is evaluated against `{"x": "3.7"}`
- **THEN** the row's computed field value is `null`

### Requirement: coalesce returns the first non-null argument
`coalesce(a, b, ...)` SHALL evaluate its arguments left to right and return the value of the first argument that does
not evaluate to `null`, without evaluating any later argument. If every argument evaluates to `null`, the result SHALL be
`null`. `coalesce` SHALL be exempt from function null propagation: a `null` argument SHALL NOT by itself make the result
`null`. An evaluation error in an argument that is reached SHALL be an evaluation error for the whole expression,
yielding `null` for that row, consistent with every other evaluation error. The selected value SHALL be returned
unchanged (no coercion). On the pipeline `compute` step, a `coalesce` whose arguments mix numeric and non-numeric types
(per the output-type-inference requirement) SHALL be reported at analyze time as that step's validation error; saving
the step SHALL remain governed by parse validity alone.

#### Scenario: coalesce supplies a fallback for a null field
- **WHEN** `coalesce($nick, $name)` is evaluated against `{"nick": null, "name": "Ada"}`
- **THEN** the result is `"Ada"`

#### Scenario: coalesce returns the first non-null value even if later ones exist
- **WHEN** `coalesce($a, $b)` is evaluated against `{"a": 1, "b": 2}`
- **THEN** the result is `1`

#### Scenario: coalesce of all-null arguments is null
- **WHEN** `coalesce($a, $b)` is evaluated against `{"a": null, "b": null}`
- **THEN** the result is `null`

#### Scenario: coalesce does not evaluate arguments after the first non-null one
- **WHEN** `coalesce($a, floor($s))` is evaluated against `{"a": 5, "s": "x"}`
- **THEN** the result is `5` (the type error in the unreached argument does not occur)

#### Scenario: an error in a reached argument nulls the row
- **WHEN** `coalesce(floor($s), 0)` is evaluated against `{"s": "x"}`
- **THEN** the row's computed field value is `null`

#### Scenario: CSV blank cells are rejoined with coalesce
- **WHEN** a CSV with columns `first,last` and rows `Ada,Lovelace`, `Grace,` (blank last), `,Hopper` (blank first) is
  loaded and a `compute` step with expression `concat(coalesce($first, ""), " ", coalesce($last, ""))` is run over it
- **THEN** the computed values are `"Ada Lovelace"`, `"Grace "`, and `" Hopper"`
- **AND** the expression `concat($first, " ", $last)` over the same rows yields `"Ada Lovelace"`, `null`, and `null`

#### Scenario: mixed-type coalesce is an analyze-time error, not a save or run block
- **WHEN** a pipeline `compute` step has expression `coalesce($n, "n/a")` where `n` is a float field
- **THEN** analyze reports a validation error on that step naming `coalesce`
- **AND** saving the step succeeds, and scheduled and dataset-write auto-runs are not skipped because of it

### Requirement: Unary minus negates a numeric operand
The strict compute expression grammar SHALL accept a prefix unary minus `-` before any operand — a numeric
literal, a `$`-prefixed column reference, a function call, a parenthesised expression, or another unary minus —
so that negative values can be written directly (`-5`, `-$x`, `mod(-7, 3)`). Unary minus SHALL bind tighter
than `*` and `/` and apply to the single operand that immediately follows it (`-$a * $b` is `(-$a) * $b`;
`-floor($x)` is the negation of `floor($x)`), and it SHALL be repeatable (`--$x` and `- -$x` equal `$x`;
`2 - -3` and `2--3` equal `5`). Its result type SHALL infer as `float`. At evaluation time its operand SHALL be
type-strict like binary `-`: a numeric operand is negated (never producing negative zero), a `null` operand
yields `null`, and a non-numeric operand is a per-row type error yielding `null` for that row. Unary plus is
not part of the grammar. Expressions accepted before this change SHALL evaluate exactly as before.

#### Scenario: Negative literal as a function argument
- **WHEN** `mod(-7, 3)` is evaluated against any row
- **THEN** the result is `2` (the same as `mod(0 - 7, 3)`)

#### Scenario: Negating a column reference
- **WHEN** `-$x` is evaluated against `{"x": 4.5}` and against `{"x": null}`
- **THEN** the results are `-4.5` and `null`

#### Scenario: Binary minus followed by unary minus
- **WHEN** `2 - -3` is evaluated
- **THEN** the result is `5`

#### Scenario: Unary minus binds tighter than multiplication
- **WHEN** `-$a * $b` is evaluated against `{"a": 2, "b": 3}`
- **THEN** the result is `-6` and the expression is equivalent to `(-$a) * $b`

#### Scenario: Negative digits for round
- **WHEN** `round($x, -2)` is evaluated against `{"x": 1234}`
- **THEN** the result is `1200`

#### Scenario: Negating a string is a type error
- **WHEN** `-$s` is evaluated against `{"s": "abc"}`
- **THEN** the row's computed field value is `null` (evaluation error, not an exception)

#### Scenario: Unary minus infers float
- **WHEN** the output type of `-$name_len` is inferred with `name_len` declared `integer`
- **THEN** the inferred type is `float`

#### Scenario: Dangling minus is a validation error
- **WHEN** the expression `$a * -` is validated
- **THEN** validation fails with a parse error message

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

### Requirement: Comparison operators compare values of one kind
The strict compute grammar SHALL support the binary comparison operators `=`, `!=`, `<`, `<=`, `>` and `>=`. A
comparison SHALL evaluate to a boolean. Comparisons SHALL be non-associative: an expression that chains two comparisons
without parentheses (`1 < $x < 5`) SHALL be a parse error. `==` and `<>` SHALL be parse errors.
- Two numbers SHALL compare numerically.
- Two text values (string or timestamp columns, string literals, text-valued functions) SHALL compare exactly, ordered
  by UTF-16 code unit; a timestamp compares as its text, not as an instant.
- Two booleans SHALL support `=` and `!=` only; an ordering comparison of booleans SHALL be a type error.
- A comparison between values of different kinds (number vs text, boolean vs number, boolean vs text) SHALL be a type
  error, never a silent `true` or `false`. At analyze time a number-vs-text comparison error SHALL tell the user to
  add a cast step to convert the text field to a number (or, for a timestamp, to use `seconds_between`).
- A comparison with a `null` operand SHALL evaluate to `null`.
- A type error at evaluation time SHALL yield `null` for that row, like every other evaluation error.

#### Scenario: numeric comparison
- **WHEN** `$amount > 100` is evaluated against `{"amount": 150}` and against `{"amount": 100}`
- **THEN** the results are the JSON booleans `true` and `false`

#### Scenario: text equality
- **WHEN** `$status = "Done"` is evaluated against `{"status": "Done"}` and `{"status": "done"}`
- **THEN** the results are `true` and `false`

#### Scenario: a number compared with text is a type error, not false
- **WHEN** `$n = "5"` is evaluated against `{"n": 5}`
- **THEN** the row's computed value is `null`

#### Scenario: null comparison is null
- **WHEN** `$x != 5` is evaluated against `{"x": null}`
- **THEN** the result is `null`

#### Scenario: chained comparison is a parse error
- **WHEN** `1 < $x < 5` is validated
- **THEN** validation fails with a parse error

### Requirement: Boolean operators use SQL three-valued logic and precedence
The strict grammar SHALL support `and`, `or` and `not` and the literals `true` and `false`, as reserved words
(case-insensitive) in the strict grammar only, including when written directly before `(` (`$a and($b)`,
`not($x)`). A reserved word where a value is expected (`$a = and`, `not`) SHALL be a parse error naming the word as
reserved; it SHALL NOT be reported as a missing `$` prefix and SHALL NOT fall back to the legacy bare-identifier
grammar. The legacy bare-identifier grammar is still tried only when the strict parse fails with the `$`-prefix error, so a
legacy (pre-`$`) expression changes behaviour only when the strict parse no longer produces that error, i.e. the
strict parse now succeeds or stops on a different error before it reaches a non-reserved bare name. In practice: (a)
every bare word is `true`/`false` (`true`, `true * 2`), now literals; or (b) the strict parser reaches a reserved word
misused as a value (`and + 1`, `not`, `not + price`) before any other bare name, now a reserved-word or syntax error.
A legacy expression containing any other bare column name reached before a reserved word (`price * and`,
`true + price`) still falls back to the legacy grammar and behaves exactly as before. Precedence from loosest to tightest SHALL be: `or`, `and`, `not`,
comparison, `+`/`-`, `*`/`/`, unary `-`; `and`/`or` are left-associative and parentheses override. Operands of `and`,
`or` and `not` SHALL be booleans; any other non-null operand SHALL be a type error. `null` SHALL follow SQL
three-valued logic: `null and false` = `false`, `null and true` = `null`, `null or true` = `true`, `null or false` =
`null`, `not null` = `null`. `and` SHALL NOT evaluate its right operand when the left is `false`, and `or` SHALL NOT
evaluate its right operand when the left is `true`.

#### Scenario: and binds tighter than or
- **WHEN** `$a or $b and $c` is evaluated against `{"a": true, "b": false, "c": false}`
- **THEN** the result is `true` (it is `$a or ($b and $c)`, not `($a or $b) and $c`)

#### Scenario: not applies to the whole comparison
- **WHEN** `not $a = $b` is evaluated against `{"a": 1, "b": 2}`
- **THEN** the result is `true` (it is `not ($a = $b)`)

#### Scenario: three-valued logic
- **WHEN** `$x > 1 and false` and `$x > 1 or true` are evaluated against `{"x": null}`
- **THEN** the results are `false` and `true`

#### Scenario: keywords before a parenthesis
- **WHEN** `$a and($b or $c)` and `not($a)` are evaluated against `{"a": true, "b": false, "c": true}`
- **THEN** the results are `true` and `false`

#### Scenario: a reserved word as a value is a reserved-word parse error
- **WHEN** `$a = and` is validated
- **THEN** validation fails with an error naming `and` as a reserved word, not the `$`-prefix error

#### Scenario: legacy expressions with other bare names still fall back
- **WHEN** the legacy expressions `price * and` and `true + price` are evaluated against
  `{"price": 2, "and": 3, "true": "x"}`
- **THEN** the results are `6` and `"x2"`, the same as before this change

#### Scenario: short-circuit skips an erroring right operand
- **WHEN** `false and floor($s) > 1` is evaluated against `{"s": "x"}`
- **THEN** the result is `false`

### Requirement: if selects one of two branches
`if(cond, then, else)` SHALL require exactly 3 arguments. It SHALL evaluate `cond` and then only the selected branch:
`then` when `cond` is `true`, `else` when `cond` is `false` or `null`. An evaluation error in the unselected branch SHALL
NOT occur. A non-boolean, non-null condition SHALL be a type error. The selected value SHALL be returned unchanged.

#### Scenario: conditional count column
- **WHEN** `if($status = "Done", 1, 0)` is evaluated against rows with status `"Done"`, `"Open"` and `null`
- **THEN** the results are `1`, `0` and `0`
- **AND** an aggregate `sum` over that column counts the Done rows

#### Scenario: unselected branch is not evaluated
- **WHEN** `if($b = 0, 0, $a / $b)` is evaluated against `{"a": 4, "b": 0}`
- **THEN** the result is `0`, not `null`

#### Scenario: wrong arity is a parse error
- **WHEN** `if($a > 1, 1)` is validated
- **THEN** validation fails naming `if` and its 3 arguments

### Requirement: Boolean columns are booleans in expressions
A JSON boolean cell referenced by `$name` SHALL evaluate as a boolean (usable as an `if` condition and with `and`,
`or`, `not`, `=`, `!=`). `+` and `concat` with a boolean SHALL concatenate its text `true`/`false`, as before. A
boolean used where a number is required SHALL remain a type error.

#### Scenario: boolean column as a condition
- **WHEN** `if($flag, "yes", "no")` is evaluated against `{"flag": true}`
- **THEN** the result is `"yes"`

#### Scenario: plus still concatenates a boolean
- **WHEN** `$flag + 1` is evaluated against `{"flag": true}`
- **THEN** the result is the JSON string `"true1"`

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
