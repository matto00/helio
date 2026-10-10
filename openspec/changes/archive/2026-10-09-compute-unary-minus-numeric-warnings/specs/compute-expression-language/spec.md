## ADDED Requirements

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

## MODIFIED Requirements

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
