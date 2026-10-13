# Compute step expression grammar

Shared contract between the backend (`backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala`)
and the frontend (`frontend/src/features/pipelines/ui/stepConfigs/ComputeFieldConfig.tsx`) for the
pipeline **Compute** step's `expression` field. This is the grammar `ExpressionEvaluator.validate`
enforces (strict, `$`-required) — the same grammar the step-card UI's hints and placeholder text
describe.

> This doc covers the pipeline Compute step's expression language. `data_types.computedFields[]`
> (the separate DataType computed-fields feature, `ComputedFieldForm.tsx`) is unrelated and keeps
> its own bare-identifier-tolerant grammar — see "Legacy compatibility" below for why.

## Literals

| Kind             | Syntax                                     | Example       |
| ---------------- | ------------------------------------------ | ------------- |
| Numeric constant | digits, optional single `.`                | `1.05`, `100` |
| Negative number  | unary `-` before a numeric constant        | `-5`, `-0.5`  |
| String literal   | double-quoted, `\"`/`\\`/`\n`/`\t` escapes | `"Total: "`   |
| Boolean literal  | `true`, `false` (reserved words)           | `true`        |

## Column references — `$` required

A column (field) reference is written as `$` immediately followed by an identifier matching
`[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*` — one or more `_`/alphanumeric segments optionally
joined by interior dots, e.g. `$price`, `$first_name`, `$stats.pts_ppr`. **A bare identifier
without the `$` prefix is always a parse error** under this grammar — this disambiguates a column
reference from a bare word that might otherwise be mistaken for a string. (Numeric constants and
double-quoted string literals never need `$`.) A dot is admitted only between two identifier
characters: a leading, trailing, or doubled dot (`$.a`, `$a.`, `$a..b`) is a parse error, not a
silently-truncated or empty segment. A trailing or doubled dot directly after a `$`-reference
(`$stats.`, `$a..b`) produces a message naming it as an **incomplete dotted column reference** —
not a "number literal" — since the leftover text is a reference typo, not a malformed number. A
leading-dot number literal on its own (`$amount * .5`, or a standalone `1.2.3`) is unaffected and
keeps its ordinary numeric-literal handling/message.

```
$price * $qty
$first_name + " " + $last_name
$stats.pts_ppr * 2
```

### Dotted references name one flattened column — exact match, no traversal

A dotted reference such as `$stats.pts_ppr` names exactly **one** column whose literal name
contains those dots — it is never split into segments and never traversed as a path into a nested
value. Resolution is a plain exact-key lookup against the row (at evaluation time) or the schema's
field names (at validation/inference time): a reference `$stats.pts_ppr` resolves if and only if a
column literally named `stats.pts_ppr` exists, with no shorter-prefix fallback (`$stats.pts_ppr`
never resolves to a column named just `stats`, even if one exists).

This is unambiguous rather than an arbitrary tie-break: by the time an expression evaluates, every
row is already a **flat** `Map[String, JsValue]` produced by `JsonFlattener`, which flattens nested
JSON into dotted column names and deduplicates a literal-dotted-name collision (e.g. a source
object containing both a literal key `"a.b"` and a nested `{"a": {"b": ...}}`) down to a single
`a.b` column before any expression ever runs. There is no nested structure left to traverse and no
second candidate interpretation competing with the literal one — the evaluator inherits the
flattener's already-resolved decision rather than re-deciding it.

If no column matches, the error names the whole unresolved dotted reference and says it is matched
as a single literal (flattened) column name, not a path — so the fix is to check the exact column
name (e.g. after a `rename` step that stripped the prefix), not to look for a nested value.

## Operators

| Operator | Meaning      | Type rule                                                                                                                                                                                                                    |
| -------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+`      | Add / concat | **Permissive**: numeric if both sides are numbers; string concatenation (coercing the other side to string) if either side is a string. A `timestamp` field is text at run time, so `$ts + 1` concatenates (`"2026-07-011"`) |
| `-`      | Subtract     | **Strict**: both sides must be numbers, or it's a `TypeError`. Not defined on timestamps: use `seconds_between`                                                                                                              |
| `*`      | Multiply     | **Strict**: both sides must be numbers, or it's a `TypeError`                                                                                                                                                                |
| `/`      | Divide       | **Strict**: both sides must be numbers, or it's a `TypeError`; dividing by `0` produces a per-row `null`, not an exception                                                                                                   |

Precedence and associativity follow ordinary arithmetic: `*`/`/` bind tighter than `+`/`-`, all
left-associative, and parentheses `(...)` override precedence. The comparison and boolean operators
below sit looser than arithmetic; the full table is under "Comparison, boolean and conditional logic".
`+` with a boolean operand concatenates its text (`true`/`false`), exactly as it did when a boolean
column was read as text: `$flag + 1` is `"true1"`.

```
$a + $b * $c        // multiplication happens first
($a + $b) * $c      // parens override
```

### Unary minus

A prefix `-` negates the single operand that follows it, so negative values are written directly
(`-5`, `-$x`, `mod(-7, 3)`, `round($x, -2)`). It is **strict** like binary `-` and infers `float`:
a number is negated (never producing negative zero), `null` stays `null`, and a string operand is a
per-row `TypeError` (row value `null`).

- **Binds tighter than `*`/`/`** and applies to one factor — a literal, `$ref`, function call or
  parenthesised group: `-$a * $b` is `(-$a) * $b`; `-floor($x)` is `-(floor($x))`;
  `-$a + $b` is `(-$a) + $b`; `-($a + $b)` negates the whole group. There is no power operator, so
  `-2 ^ 2`-style ambiguity cannot arise.
- **Repeatable**: `--$x` and `- -$x` both equal `$x`; `2 - -3` and `2--3` both equal `5`.
- **No unary plus**: `+5` stays a parse error.
- A dangling minus (`$a * -`) is a parse error.
- The legacy bare-identifier grammar (see "Legacy compatibility") is frozen and has **no** unary
  minus: a legacy expression such as `-price` fails exactly as it did before.

```
mod(-7, 3)          // 2
2 - -3              // 5
-$a * $b            // (-$a) * $b
round(1234, -2)     // 1200
```

## Comparison, boolean and conditional logic

HEL-1070. Strict grammar only; the frozen legacy bare-identifier grammar gains nothing.

### Comparison operators

`=`, `!=`, `<`, `<=`, `>`, `>=` compare two values and produce a **boolean** (a JSON `true`/`false`,
inferred type `boolean`). `==` and `<>` are parse errors that name the right operator (`=`, `!=`).

| Operands                                                      | Result                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| number, number                                                | numeric comparison                                                                            |
| text, text (string, string-body, timestamp, text functions)   | exact comparison by UTF-16 code unit: case matters, `"B" < "a"`. A timestamp compares as text |
| boolean, boolean                                              | `=` and `!=` only; `<`, `<=`, `>`, `>=` on booleans is a type error                           |
| any other pairing (number/text, boolean/number, boolean/text) | **type error**, never a silent `true`/`false`                                                 |
| either side `null`                                            | `null`                                                                                        |

At analyze time a mismatched comparison is an **inference error** (the step's `validationError`; the step still
saves). A number-vs-text message tells you to add a cast step to convert the text field to a number, and when the
text side is a timestamp, to compare instants with `seconds_between(a, b)` instead. At run time a type error nulls
that row like every other evaluation error.

Comparisons are **non-associative**: `1 < $x < 5` is a parse error; write `$x > 1 and $x < 5`.

### Boolean operators

`and`, `or`, `not` (case-insensitive) and the literals `true`, `false` are **reserved words** in the strict grammar,
including directly before `(` (`$a and($b)`, `not($x)`). A reserved word where a value is expected (`$a = and`, a
bare `not`) is a parse error that names the word as reserved; it is never reported as a missing `$` prefix and never
falls back to the legacy grammar.

Precedence, loosest to tightest:

| Level | Construct                  |
| ----- | -------------------------- |
| 1     | `or` (left-associative)    |
| 2     | `and` (left-associative)   |
| 3     | `not` (prefix, repeatable) |
| 4     | `=` `!=` `<` `<=` `>` `>=` |
| 5     | `+` `-`                    |
| 6     | `*` `/`                    |
| 7     | unary `-`                  |

So `$a or $b and $c` is `$a or ($b and $c)`, `not $a = $b` is `not ($a = $b)`, and
`$a + 1 > $b * 2` compares two arithmetic results. Parentheses override.

Operands of `and`/`or`/`not` must be booleans (or `null`); any other value is a type error. A boolean **column**
is a boolean in expressions (see below), so `$flag and not $other` works.

**Null follows SQL three-valued logic:**

| `a`     | `b`     | `a and b` | `a or b` | `not a` |
| ------- | ------- | --------- | -------- | ------- |
| `true`  | `null`  | `null`    | `true`   | `false` |
| `false` | `null`  | `false`   | `null`   | `true`  |
| `null`  | `true`  | `null`    | `true`   | `null`  |
| `null`  | `false` | `false`   | `null`   | `null`  |
| `null`  | `null`  | `null`    | `null`   | `null`  |

`and` does not evaluate its right operand when the left is `false`, and `or` does not when the left is `true`, so
`false and floor($s) > 1` is `false` rather than an error.

### `if(cond, then, else)`

Exactly three arguments. `cond` is evaluated, then **only the chosen branch**: `then` when `cond` is `true`, `else`
when it is `false` **or `null`**. An error in the unchosen branch never happens: `if($b = 0, 0, $a / $b)` is `0`
when `$b` is `0`. A non-boolean, non-null `cond` is a type error. The chosen value is returned unchanged. Nest `if`
for several cases:

```
if($n < 10, "low", if($n < 100, "mid", "high"))
```

Branch types follow the `coalesce` rule (see "Output type inference"): the same type, or numbers mixed (`float`);
any other mix is an analyze-time error.

### Boolean columns

A JSON boolean cell referenced as `$flag` is a **boolean** (before HEL-1070 it read as the text `"true"`, although
analyze already reported `boolean`). So a bare `$flag`, `coalesce($flag, false)` or `if(c, $flag, false)` now
produces a JSON boolean, and `$flag` works as an `if` condition. Everything that treated it as text still does:
`+`/`concat` concatenate `true`/`false`, and `length`/`upper`/`lower`/`substring` read it as text
(`length($flag)` is `4`). Used where a number is required it is still a type error, and a boolean given to
`seconds_between`/`date_trunc`/`add_days` is "not a timestamp" (row `null`, never a run failure).

A boolean-valued expression other than a bare column (`($s = "Done") * 1`, `floor($a > 1)`) used as a number is an
**analyze-time error** suggesting `if(cond, 1, 0)`, because it would null every row. `($s = "Done") + 1` is legal but
concatenates (`"true1"`, typed `string`).

### Recipe: conditional count and sum

A single pipeline can count or sum conditionally: add a compute column, then aggregate it.

```
compute  is_done = if($status = "Done", 1, 0)         // 1 / 0 per row (a null status takes the else branch)
compute  done_points = if($status = "Done", $points, 0)
aggregate sum(is_done) AS done, count(status) AS total, sum(done_points) AS done_points
```

The percentage is a further compute step: `if($total = 0, 0, $done / $total * 100)`.

### Legacy expressions and the reserved words

A legacy (`$`-less) expression changes behaviour only when its strict parse no longer ends in the `$`-prefix
error, i.e. when the strict parser now succeeds or stops on another error before it reaches a non-reserved bare
name: an expression made only of `true`/`false` bare words (`true` is the literal; `true * 2` is a per-row type
error), or one that misuses a reserved word as a value first (`and + 1`, `not`, `not + price`, now parse errors).
Expressions that reach another bare name first (`price * and`, `true + price`, `True + price`) fall back and behave
exactly as before. A column literally named `and`, `or`, `not`, `true` or `false` therefore cannot be referenced
without `$`; `$and` etc. work.

## Functions

Function-call syntax is `name(arg1, arg2, ...)`. Arguments are themselves expressions (literals,
`$refs`, or nested calls) and are evaluated left-to-right. Functions bind like a single factor, so
`concat($a, $b) + "!"` parses unambiguously (the `+` applies to the whole call's result).

| Function                      | Arity  | Behavior                                                                                                                                                                                                                                                  | Errors                                                                                                                                |
| ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `concat(a, b, ...)`           | ≥ 1    | Joins all arguments as strings (numbers coerced, same as `+`'s coercion)                                                                                                                                                                                  | —                                                                                                                                     |
| `substring(s, start, end)`    | 3      | 0-indexed, `end` exclusive; **out-of-range `start`/`end` are clamped to `[0, length(s)]`, not an error**                                                                                                                                                  | first argument must be a string (`TypeError` otherwise)                                                                               |
| `lower(s)`                    | 1      | Lowercases a string                                                                                                                                                                                                                                       | non-string argument is a `TypeError`                                                                                                  |
| `upper(s)`                    | 1      | Uppercases a string                                                                                                                                                                                                                                       | non-string argument is a `TypeError`                                                                                                  |
| `length(s)`                   | 1      | Character count as a number                                                                                                                                                                                                                               | non-string argument is a `TypeError`                                                                                                  |
| `floor(x)`                    | 1      | Rounds toward negative infinity (`floor(-2.5)` = `-3`)                                                                                                                                                                                                    | non-numeric argument is a `TypeError`                                                                                                 |
| `ceil(x)`                     | 1      | Rounds toward positive infinity (`ceil(-2.5)` = `-2`)                                                                                                                                                                                                     | non-numeric argument is a `TypeError`                                                                                                 |
| `abs(x)`                      | 1      | Absolute value                                                                                                                                                                                                                                            | non-numeric argument is a `TypeError`                                                                                                 |
| `round(x)` / `round(x, d)`    | 1 or 2 | Rounds half **away from zero** on the value's decimal form: `round(2.5)` = `3`, `round(-2.5)` = `-3`, `round(2.675, 2)` = `2.68`. `d` must be a whole number; negative `d` rounds to tens/hundreds (`round(1234, -2)` = `1200`); `d` is clamped to ±308   | non-numeric argument, or fractional `d`, is a `TypeError`                                                                             |
| `mod(a, b)`                   | 2      | **Floored** remainder, sign follows the divisor `b`: `mod(7, 3)` = `1`, `mod(-7, 3)` = `2`, `mod(7, -3)` = `-2`, `mod(5.5, 2)` = `1.5` (differs from SQL/Java truncated `%`)                                                                              | non-numeric argument is a `TypeError`; `b` = `0` is a per-row `null`, like `/`                                                        |
| `if(cond, then, else)`        | 3      | Evaluates `cond`, then only the chosen branch: `then` when `true`, `else` when `false` or `null`. See "Comparison, boolean and conditional logic"                                                                                                         | non-boolean `cond` is a `TypeError`; wrong arity is a parse error                                                                     |
| `coalesce(a, b, ...)`         | ≥ 2    | Returns the first argument that is not `null`, evaluating left to right and **stopping at the first non-null** (later arguments are never evaluated); all `null` → `null`. The one function exempt from null propagation. The value is returned unchanged | fewer than 2 arguments is a parse error; an error in a reached argument nulls the row                                                 |
| `seconds_between(end, start)` | 2      | `end - start` in seconds as a float, fractions kept, unrounded; negative when `end` precedes `start`                                                                                                                                                      | an unparseable timestamp (or a `null`) gives `null` for the row, never a failure                                                      |
| `date_trunc(unit, ts)`        | 2      | Floors `ts` to the start of the UTC `unit` bucket and returns an ISO-8601 instant string (`2026-07-01T00:00:00Z`). `unit` is a double-quoted literal: `second`, `minute`, `hour`, `day`, `week` (ISO Monday), `month`, `quarter`, `year`                  | an unknown, non-literal or bare-word unit is a **parse error** naming the units (single quotes are not string syntax in this grammar) |
| `add_days(ts, n)`             | 2      | `ts` plus exactly `n` x 86400 seconds (whole or fractional, no calendar or DST adjustment), as an ISO-8601 instant string; no month or year addition                                                                                                      | a non-numeric `n` is a `TypeError` (row `null`); a result outside the representable range is `null`                                   |

An unknown function name, or a call with the wrong number of arguments, is a **parse error**
(caught by `validate()` before the expression is ever run against a row).

```
concat($first_name, " ", $last_name)   // "Ada Lovelace"
substring($sku, 0, 3)                  // "ABC" from "ABC-1234"
substring($sku, 0, 999)                // clamps to the full string — no error
upper($code)                           // "AB12" from "ab12"
length($name)                          // 3
round($rate * 100, 1)                  // 87.3 from 0.8734
mod($n, 3)                             // bucket index; mod(-7, 3) = 2
coalesce($nick, $name)                 // "Ada" when nick is null and name is "Ada"
concat(coalesce($first, ""), " ", coalesce($last, ""))   // "Grace " when last is blank
```

The numeric functions are numeric-strict, like `-`/`*`/`/`: a string argument — including a numeric
string such as `"3.7"` from an uncast CSV column — is a `TypeError` (row value `null`); use a `cast`
step first. Their results are floats on the wire, so analyze-time and run-time types agree.

Using a text field where a number is required (`floor($price)`, `$s - 1`, `-$s` over a string,
boolean or `timestamp` column, or a text day count in `add_days`) compiles but nulls every non-null row. **Analyze warns** about it
(`numeric-op-on-text-field`, non-blocking, only when the input schema's types are trusted — e.g.
an uncast CSV column): add a `cast` step first. A text `start`/`end` of `substring` counts too, and so does
a `string-body` field in `$sb + 1`, which concatenates (inferring `string`) rather than adds.

Trust is tracked **per column**: a `compute` step leaves the columns it passes through as trusted as they
were (an uncast CSV column still warns after an unrelated `compute`) and makes only the column it writes
untrusted. The join and lookup key type checks use the same per-side, per-column trust.

The opposite mistakes warn too, also non-blocking: a trusted `integer`/`float` field passed to `length`,
`lower`, `upper` or `substring`'s first argument (`text-function-on-numeric-field`; wrap it in `concat(...)`),
and a wrong-type **literal** — a string literal where a number is required (`"3" * 2`) or a number literal given
to a text function (`length(5)`) — `literal-type-mismatch`, which needs no input trust because the literal's
type is known. A literal behind `coalesce`, `if` or a comparison does not warn (the row need not be null).

**Depth limits.** An expression nested more than **100** levels (brackets, function arguments, unary `-`,
`not`) or whose parsed tree is deeper than **200** levels (e.g. a very long flat `a + a + a + …` chain) is a
parse error, never a stack overflow. This applies to the legacy bare-identifier grammar too.

If any argument evaluates to `null` (e.g. an unset field), the whole call's result is `null`
(same null-propagation as the binary operators) rather than an error. **`coalesce` is the exception.**

### Dates and times

`seconds_between`, `date_trunc` and `add_days` read every timestamp argument through the one shared
parser (`TimestampParsing.parseInstant`), in **UTC**: an ISO instant or offset date-time (converted
to UTC), a timezone-less `T`- or space-separated date-time (read as UTC, optional seconds and 0-9
fraction digits), a bare `yyyy-MM-dd` (midnight UTC), or a whole-number epoch (seconds, or
milliseconds above 9999999999), given as a number or a numeric string (`"1.7712864E9"` is fine).
The datebucket step reads timestamps through the same parser. Anything else (blank, garbage,
`2026-13-01`, a fractional epoch) is "not a timestamp" and gives `null` for that row. There is no
`now()`/`today()` (a run must be reproducible) and `-` is not defined on timestamps.

```
seconds_between($started_at, $created_at)   // queue time in seconds, e.g. 90
date_trunc("week", $created_at)             // "2026-03-16T00:00:00Z" (Monday) for 2026-03-19
add_days($created_at, 7)                    // one week later
```

A `cast` to `timestamp`/`date` still also keeps values the source-schema reader accepts (such as
`MM/dd/yyyy`), which the shared parser reads as `null`; cast keeps the original string either way.
The Spark execution path (`SparkJobSubmitter`'s `F.expr`) does not have these functions.

### Blank CSV cells and `coalesce`

A blank CSV cell loads as `null` (HEL-1408), so `concat($first, " ", $last)` is `null` for a row
where either part is blank. Supply a fallback with `coalesce`:
`concat(coalesce($first, ""), " ", coalesce($last, ""))` turns rows `Ada,Lovelace`, `Grace,` and
`,Hopper` into `"Ada Lovelace"`, `"Grace "` and `" Hopper"`.

## Errors

Parse/validation errors surface as a human-readable message (e.g. `"Column references require a
'$' prefix"`, `"Unknown field: foo"`, `"'reverse' is not a recognized function; supported functions: abs, add_days, ceil, coalesce, concat, date_trunc, floor, if, length, lower, mod, round, seconds_between, substring, upper"`,
`"substring requires 3 arguments"`). At **analyze time** (`PipelineAnalyzeService.inferCompute`),
this message is set on `AnalyzedStep.validationError` and rendered inline under the expression
input in the step-card UI (`ComputeFieldConfig`). At **row-execution time**
(`ComputeStep.apply`), any evaluation failure for a given row
(parse error, unknown field, division by zero, type error) yields `null` for that row rather than
throwing — the pipeline keeps running.

## Output type inference

`ExpressionEvaluator.inferType` derives the compute step's output field type (`"float"`, `"string"`, `"timestamp"` or `"boolean"`) directly from the expression, instead of trusting a possibly-stale `type` value on the
wire:

- Numeric literals and arithmetic (`-`, `*`, `/`, unary `-`, and `+` when neither side is a string or timestamp) → `float`
- String literals, `concat`, `substring`, `lower`, `upper` → `string`
- `length`, `floor`, `ceil`, `round`, `mod`, `abs`, `seconds_between` → `float`
- `date_trunc`, `add_days` → `timestamp` (the value is an ISO-8601 string)
- `+` → `string` if either operand infers `string`, `string-body`, `timestamp` or `boolean`, else `float`
- `true`, `false`, comparisons, `and`, `or`, `not` → `boolean`; a boolean column referenced alone → `boolean`
- `if` → `boolean`-condition required (else an error naming `if`); its result is the **common type of its two
  branches**, by the `coalesce` rule below
- A comparison whose operands are different kinds (numeric; text = `string`/`string-body`/`timestamp`; boolean),
  an ordering comparison of booleans, a `binary-ref` operand, a non-boolean `and`/`or`/`not` operand, and a
  boolean expression used as a number (see "Boolean columns") are **analyze-time errors** naming the operator
- A `$`-prefixed field reference inherits its type from the input schema
- `coalesce` → the **common type of its arguments**: all the same type → that type; all numeric
  (`integer`/`float`) → `float`; no numeric and no boolean argument → `string`. A **boolean/non-boolean mix**
  (`coalesce($flag, "x")`) is an analyze-time error too. A **numeric/text mix**
  (`coalesce($n, "n/a")` with `n` numeric) has no truthful type and is an **analyze-time error** on the
  step (`validationError`, naming `coalesce` and suggesting `concat(...)`: `coalesce(concat($n), "n/a")`
  infers `string`). The error is analyze-only: the step still saves, and manual, scheduled and
  dataset-write runs still fire, though the column's values may be wrong. The pipeline page shows its
  step-config-invalid notice ("A step in this pipeline has a problem, so its results may be wrong or missing
  until that step is fixed.") for it, as for any schema-derived compute error (e.g. `Unknown field`); the
  notice is display only and does not stop a run.

### Checking an expression with `validate-expression`

`POST /api/pipelines/:id/validate-expression?stepId=` answers with the same verdict analyze gives an
enabled `compute` step with that expression at that node: `{"valid": true}` or `{"valid": false, "error":
"..."}`, where `error` is analyze's message verbatim. That includes type errors (mixed-type `coalesce`,
number-vs-text comparisons, mismatched `if()` branches, date-function argument types), not just syntax and
unknown fields. `valid: false` means analyze would flag the expression; it does **not** mean saving a step
with that expression is rejected (compute save only checks that it parses). Analyze's non-blocking
warnings are not reported by this endpoint.

### Known limitation: a timestamp-typed column that carries a number

The `+` rule above assumes a `timestamp`-typed column is text at run time. That holds for `cast`,
`datebucket`, JSON/SQL schema inference (a `timestamp` type comes only from string values) and dataset
sources. Two paths can still deliver a JSON number under a `timestamp` projection (HEL-1491):

- `fillnull` with `mean`/`median` over epoch-valued timestamp strings: the schema stays `timestamp`,
  but the filled cells are numbers.
- A `union` whose secondary lane has a same-named numeric field (or the reverse): the parent lane's
  type wins on the name collision, while the rows mix numbers and timestamp strings.

Analyze now **flags** both as a step error (`validationError` on the `fillnull` or `union` step, shown
on the step card and surfaced as a `step-config-invalid` reason with `canRun: false`): `fillnull`
`mean`/`median` listing a `timestamp` column, and a `lane`-kind `union` whose parent and secondary types
for a shared field are `timestamp` versus `integer`/`float`. The fix is to use `forwardFill`, `mode` or
`constant`, cast the column to a number first, or cast one union side so the types match.

This flags the disagreement; it does not remove it:

- Run time is unchanged and is not blocked. `canRun: false` only hides the editor's "Run to update"
  prompt; Run, Dry run, scheduled runs and auto-runs still execute.
- The projected type is unchanged (the parent lane's type for a union, the input type for `fillnull`).
  With a `timestamp` column, a downstream `$ts + ...` is still inferred as text while a run started
  anyway can still produce a number. In the reverse union case (numeric parent, timestamp secondary) the
  projection stays numeric while timestamp strings arrive under it.
- A `union` with a `source`-kind secondary input (its default shape) is **not checked**: analyze does
  not resolve that secondary's schema for `union`, so the collision is invisible there. Known gap.
- Other collisions (for example `string` versus `integer`) and `mean`/`median` over a `string` column
  holding numeric strings are out of scope.

## Legacy compatibility

Expressions persisted before this grammar existed used bare identifiers with no `$` prefix (e.g.
`price * quantity`). These keep **running** unmodified: `ExpressionEvaluator.evaluate` (the
row-execution entry point) retries a bare-identifier-only legacy grammar if strict parsing fails
specifically on the "`$` prefix required" error. Live validation (`validate`, used by
`PipelineAnalyzeService.inferCompute` for the step-card UI) never falls back — a legacy expression
still shows a `validationError` as a nudge to update it, even though it continues to execute
correctly. There is no data migration; this is a pure code-level compatibility shim.

`data_types.computedFields[]` expressions (a separate feature, unrelated to the pipeline Compute
step) use `ExpressionEvaluator.validateTolerant`, which applies the same legacy-fallback behavior
to _validation_ as well — because that feature's save path (`PATCH /api/types/:id`) hard-blocks the
whole request on any invalid expression, tightening it to the `$`-required grammar was out of scope
for this change (see the `compute-step-expression-rework` OpenSpec change's design doc, Decision 4).

## Known limitations (non-goals)

- No `case when`, ternary, `&&`/`||`/`!`, `null` literal or `is null`, instant-aware (timestamp) comparison, or aggregate functions (aggregate in a following `aggregate` step).
- No autocomplete for column references (stretch goal, not implemented).
- No member-access/property-traversal operator — a dot is only ever part of a literal column
  name, never an operator, and no quoted/bracketed reference syntax exists for column names
  containing spaces or operator characters.
- Pre-existing, out of scope: the Spark execution path (`SparkJobSubmitter`) hands the same
  stored expression string to Spark SQL's `F.expr`, a different grammar where `$` is not a
  column sigil and a dotted name means struct access unless backtick-quoted. This divergence
  predates dotted references and is unaffected (not fixed) by this grammar change. The comparison and boolean
  syntax is likewise not Spark-compatible (`=`/`and` happen to parse there, `if` is a different function, and the
  three-valued/typing rules differ). Unary minus
  itself exists in Spark SQL with the same precedence, but `--` begins a SQL line comment there, so
  `2--3` / `--$x` would differ; every `$`-reference expression already diverges on that path.
