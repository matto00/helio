# compute-expression-language Specification

## Purpose
Defines the shared expression grammar (literals, `$`-prefixed column references, operators,
string functions, type-coercion rules) that both the pipeline Compute step's engine and its
step-card UI implement as a single documented contract.
## Requirements
### Requirement: Column references require a `$` prefix
`ExpressionEvaluator` SHALL treat `$` followed by an identifier (`[A-Za-z_][A-Za-z0-9_]*`) as a
field reference. A bare identifier not preceded by `$` and not immediately followed by `(`
(a function call, see below) SHALL be a parse error. Numeric constants and double-quoted string
literals are unaffected by this requirement.

#### Scenario: `$`-prefixed identifier resolves to a field reference
- **WHEN** the expression `$price * $qty` is evaluated against a row `{"price": 2, "qty": 3}`
- **THEN** the result is `6`

#### Scenario: Bare identifier without `$` is a parse error
- **WHEN** the expression `price * qty` is validated
- **THEN** validation returns an error indicating column references require a `$` prefix

#### Scenario: Numeric constant does not require `$`
- **WHEN** the expression `$amount * 1.05` is evaluated against a row `{"amount": 100}`
- **THEN** the result is `105`

#### Scenario: String literal does not require `$`
- **WHEN** the expression `$first_name + " " + $last_name` is evaluated against a row
  `{"first_name": "Ada", "last_name": "Lovelace"}`
- **THEN** the result is `"Ada Lovelace"`

### Requirement: Function-call syntax for string operations
`ExpressionEvaluator` SHALL support function-call syntax `name(arg1, arg2, ...)` for a fixed set
of string functions: `concat` (variadic, arity ≥ 1), `substring` (arity 3: value, start, end —
0-indexed, end exclusive), `lower` (arity 1), `upper` (arity 1), and `length` (arity 1). Function
arguments are themselves expressions (literals, `$refs`, or nested calls). An unknown function
name, or a call with the wrong arity, SHALL be a parse error.

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

#### Scenario: Wrong arity is a parse error
- **WHEN** the expression `substring($name, 0)` is validated
- **THEN** validation returns an error indicating `substring` requires 3 arguments

### Requirement: Numeric operators are type-strict; `+` is coercion-permissive
`-`, `*`, and `/` SHALL require both operands to evaluate to numbers; a non-numeric operand
(after field/function resolution) SHALL be an evaluation-time `TypeError`. `+` SHALL remain
permissive: if either operand is a string, the other is coerced to its string representation
and the result is string concatenation; if both are numbers, the result is numeric addition.
Function arguments follow the same per-function type rules as their own arity/type requirements
(e.g. `substring`'s first argument must be a string).

#### Scenario: Subtracting a string field is a type error
- **WHEN** the expression `$amount - $label` is evaluated against `{"amount": 10, "label": "x"}`
- **THEN** the row's computed field value is `null` (evaluation error, not an exception)

#### Scenario: Addition coerces a number to string when the other operand is a string
- **WHEN** the expression `"Total: " + $amount` is evaluated against `{"amount": 5}`
- **THEN** the result is `"Total: 5"`

#### Scenario: Addition of two numbers stays numeric
- **WHEN** the expression `$a + $b` is evaluated against `{"a": 1, "b": 2}`
- **THEN** the result is `3` (not `"12"`)

### Requirement: Output type can be inferred from the expression AST
`ExpressionEvaluator.inferType` SHALL compute a result type (`"number"` or `"string"`) for a
given expression and a map of input field name → type, by walking the same AST used for
parsing, without evaluating against actual row data. Field references resolve via the supplied
type map; numeric literals/operators infer `"number"`; string literals, `concat`, `substring`,
`lower`, `upper` infer `"string"`; `length` infers `"number"`; `+` infers `"string"` if either
operand infers `"string"`, else `"number"`.

#### Scenario: Arithmetic expression infers number
- **WHEN** `inferType` is called with `$price * $qty` and `{"price": "number", "qty": "number"}`
- **THEN** it returns `Right("number")`

#### Scenario: Concatenation expression infers string
- **WHEN** `inferType` is called with `concat($first_name, " ", $last_name)` and
  `{"first_name": "string", "last_name": "string"}`
- **THEN** it returns `Right("string")`

#### Scenario: Unresolvable field reference is an inference error
- **WHEN** `inferType` is called with `$missing * 2` and `{}`
- **THEN** it returns `Left(...)` describing the unknown field

