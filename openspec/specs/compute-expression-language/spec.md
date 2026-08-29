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
error. Numeric constants and double-quoted string literals are unaffected by this requirement.

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
