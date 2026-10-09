## MODIFIED Requirements

### Requirement: Function-call syntax for string operations
`ExpressionEvaluator` SHALL support function-call syntax `name(arg1, arg2, ...)` for a fixed set
of functions: the string functions `concat` (variadic, arity ≥ 1), `substring` (arity 3: value, start, end —
0-indexed, end exclusive), `lower` (arity 1), `upper` (arity 1), and `length` (arity 1), and the numeric functions
`floor` (arity 1), `ceil` (arity 1), `abs` (arity 1), `round` (arity 1 or 2), and `mod` (arity 2), and the
null-handling function `coalesce` (variadic, arity ≥ 2). Function
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
- **AND** the error lists the supported functions, including `floor`, `ceil`, `round`, `mod`, `abs`, and `coalesce`

#### Scenario: Wrong arity is a parse error
- **WHEN** the expression `substring($name, 0)` is validated
- **THEN** validation returns an error indicating `substring` requires 3 arguments

#### Scenario: Wrong arity for a numeric function is a parse error
- **WHEN** the expression `mod($a)` or `round($a, 1, 2)` is validated
- **THEN** validation returns an error naming the function and its required arity

#### Scenario: coalesce with fewer than two arguments is a parse error
- **WHEN** the expression `coalesce($a)` or `coalesce()` is validated
- **THEN** validation returns the error `coalesce requires at least 2 arguments`

### Requirement: Output type can be inferred from the expression AST
`ExpressionEvaluator.inferType` SHALL compute a result type (the canonical wire values `"float"` or `"string"`, or, for `coalesce` of same-typed
arguments, that shared input type) for a
given expression and a map of input field name → type, by walking the same AST used for
parsing, without evaluating against actual row data. Field references resolve via the supplied
type map; numeric literals/operators infer `"float"`; string literals, `concat`, `substring`,
`lower`, `upper` infer `"string"`; `length`, `floor`, `ceil`, `round`, `mod`, and `abs` infer `"float"`; `+` infers
`"string"` if either operand infers `"string"`, else `"float"`. For every numeric function, the inferred type SHALL
agree with the value the same expression produces at run time on numeric input (a JSON number). `coalesce` SHALL infer
the common type of its arguments: if every argument infers the same type, that type; otherwise, if every argument
infers a numeric type (`"integer"` or `"float"`), `"float"`; otherwise, if no argument infers a numeric type,
`"string"`. If at least one argument infers a numeric type and at least one infers a non-numeric type, inference SHALL
fail with an error naming `coalesce`, the argument types, and the `concat(...)` workaround.

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

## ADDED Requirements

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
