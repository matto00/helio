# Compute step expression grammar

Shared contract between the backend (`backend/src/main/scala/com/helio/domain/ExpressionEvaluator.scala`)
and the frontend (`frontend/src/features/pipelines/ui/ComputeFieldConfig.tsx`) for the
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
| String literal   | double-quoted, `\"`/`\\`/`\n`/`\t` escapes | `"Total: "`   |

## Column references — `$` required

A column (field) reference is written as `$` immediately followed by an identifier
(`[A-Za-z_][A-Za-z0-9_]*`), e.g. `$price`, `$first_name`. **A bare identifier without the `$`
prefix is always a parse error** under this grammar — this disambiguates a column reference from
a bare word that might otherwise be mistaken for a string. (Numeric constants and double-quoted
string literals never need `$`.)

```
$price * $qty
$first_name + " " + $last_name
```

## Operators

| Operator | Meaning      | Type rule                                                                                                                              |
| -------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `+`      | Add / concat | **Permissive**: numeric if both sides are numbers; string concatenation (coercing the other side to string) if either side is a string |
| `-`      | Subtract     | **Strict**: both sides must be numbers, or it's a `TypeError`                                                                          |
| `*`      | Multiply     | **Strict**: both sides must be numbers, or it's a `TypeError`                                                                          |
| `/`      | Divide       | **Strict**: both sides must be numbers, or it's a `TypeError`; dividing by `0` produces a per-row `null`, not an exception             |

Precedence and associativity follow ordinary arithmetic: `*`/`/` bind tighter than `+`/`-`, all
left-associative, and parentheses `(...)` override precedence.

```
$a + $b * $c        // multiplication happens first
($a + $b) * $c      // parens override
```

## Functions

Function-call syntax is `name(arg1, arg2, ...)`. Arguments are themselves expressions (literals,
`$refs`, or nested calls) and are evaluated left-to-right. Functions bind like a single factor, so
`concat($a, $b) + "!"` parses unambiguously (the `+` applies to the whole call's result).

| Function                   | Arity | Behavior                                                                                                 | Errors                                                  |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `concat(a, b, ...)`        | ≥ 1   | Joins all arguments as strings (numbers coerced, same as `+`'s coercion)                                 | —                                                       |
| `substring(s, start, end)` | 3     | 0-indexed, `end` exclusive; **out-of-range `start`/`end` are clamped to `[0, length(s)]`, not an error** | first argument must be a string (`TypeError` otherwise) |
| `lower(s)`                 | 1     | Lowercases a string                                                                                      | non-string argument is a `TypeError`                    |
| `upper(s)`                 | 1     | Uppercases a string                                                                                      | non-string argument is a `TypeError`                    |
| `length(s)`                | 1     | Character count as a number                                                                              | non-string argument is a `TypeError`                    |

An unknown function name, or a call with the wrong number of arguments, is a **parse error**
(caught by `validate()` before the expression is ever run against a row).

```
concat($first_name, " ", $last_name)   // "Ada Lovelace"
substring($sku, 0, 3)                  // "ABC" from "ABC-1234"
substring($sku, 0, 999)                // clamps to the full string — no error
upper($code)                           // "AB12" from "ab12"
length($name)                          // 3
```

If any argument evaluates to `null` (e.g. an unset field), the whole call's result is `null`
(same null-propagation as the binary operators) rather than an error.

## Errors

Parse/validation errors surface as a human-readable message (e.g. `"Column references require a
'$' prefix"`, `"Unknown field: foo"`, `"'reverse' is not a recognized function"`,
`"substring requires 3 arguments"`). At **analyze time** (`PipelineAnalyzeService.inferCompute`),
this message is set on `AnalyzedStep.validationError` and rendered inline under the expression
input in the step-card UI (`ComputeFieldConfig`). At **row-execution time**
(`ComputeStep.apply`/`SourceService.applyComputedFields`), any evaluation failure for a given row
(parse error, unknown field, division by zero, type error) yields `null` for that row rather than
throwing — the pipeline keeps running.

## Output type inference

`ExpressionEvaluator.inferType` derives the compute step's output field type (`"number"` or
`"string"`) directly from the expression, instead of trusting a possibly-stale `type` value on the
wire:

- Numeric literals and arithmetic (`-`, `*`, `/`, and `+` when neither side is a string) → `number`
- String literals, `concat`, `substring`, `lower`, `upper` → `string`
- `length` → `number`
- `+` → `string` if either operand infers `string`, else `number`
- A `$`-prefixed field reference inherits its type from the input schema

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

- No unary minus / negative number literals (e.g. `-5` as a standalone value) — only binary `-`.
- No boolean/comparison operators, conditionals, or aggregate functions.
- No autocomplete for column references (stretch goal, not implemented).
