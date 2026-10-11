## ADDED Requirements

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

## MODIFIED Requirements

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
- `+` infers `"string"` if either operand infers `"string"`, `"timestamp"` or `"boolean"` (each is concatenated as
  text); otherwise it infers `"float"`.
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
