## MODIFIED Requirements

### Requirement: Function-call syntax for string operations
`ExpressionEvaluator` SHALL support function-call syntax `name(arg1, arg2, ...)` for a fixed set
of functions: the string functions `concat` (variadic, arity ≥ 1), `substring` (arity 3: value, start, end —
0-indexed, end exclusive), `lower` (arity 1), `upper` (arity 1), and `length` (arity 1), and the numeric functions
`floor` (arity 1), `ceil` (arity 1), `abs` (arity 1), `round` (arity 1 or 2), and `mod` (arity 2). Function
arguments are themselves expressions (literals, `$refs`, or nested calls). An unknown function
name, or a call with the wrong arity, SHALL be a parse error. The unknown-function error message SHALL name the
unrecognized function and list every supported function name.

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

#### Scenario: Unknown function name is a parse error
- **WHEN** the expression `reverse($name)` is validated
- **THEN** validation returns an error indicating `reverse` is not a recognized function
- **AND** the error lists the supported functions, including `floor`, `ceil`, `round`, `mod`, and `abs`

#### Scenario: Wrong arity is a parse error
- **WHEN** the expression `substring($name, 0)` is validated
- **THEN** validation returns an error indicating `substring` requires 3 arguments

#### Scenario: Wrong arity for a numeric function is a parse error
- **WHEN** the expression `mod($a)` or `round($a, 1, 2)` is validated
- **THEN** validation returns an error naming the function and its required arity

### Requirement: Output type can be inferred from the expression AST
`ExpressionEvaluator.inferType` SHALL compute a result type (the canonical wire values `"float"` or `"string"`) for a
given expression and a map of input field name → type, by walking the same AST used for
parsing, without evaluating against actual row data. Field references resolve via the supplied
type map; numeric literals/operators infer `"float"`; string literals, `concat`, `substring`,
`lower`, `upper` infer `"string"`; `length`, `floor`, `ceil`, `round`, `mod`, and `abs` infer `"float"`; `+` infers
`"string"` if either operand infers `"string"`, else `"float"`. For every numeric function, the inferred type SHALL
agree with the value the same expression produces at run time on numeric input (a JSON number).

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

## ADDED Requirements

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
- **WHEN** `round($x, 0 - 2)` (the grammar has no unary minus) is evaluated against `{"x": 1234}`
- **THEN** the result is `1200`

#### Scenario: round with fractional digits is a type error
- **WHEN** `round($x, 1.5)` is evaluated against `{"x": 3.14159}`
- **THEN** the row's computed field value is `null`

#### Scenario: mod sign follows the divisor
- **WHEN** `mod($a, 3)` is evaluated against `{"a": -7}`, and `mod($a, 0 - 3)` against `{"a": 7}`
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
