# HEL-1455: After HEL-1403: numeric-op-on-text-field warning gaps (`+` with boolean/string-body, per-step type trust, string fns on numbers, literal operands); deep unary-minus chains

## Description

Origin: HEL-1403 (matto00/helio#902, 365d824c), reported by the lane.

1. `floor($b + 1)` with a boolean or string-body field doesn't warn, because `+` infers numeric unless one side is exactly `string`.
2. Type trust is tracked per step, not per column. CSV → compute (on another column) → `floor($price)` stays silent. Consider per-column trust.
3. After HEL-1436 lands (the CastStep float/timestamp fall-through), confirm the warning covers casts that left strings, with no further change needed.
4. Not covered: string functions given numbers (`length($n)`), string-literal operands (`"3" * 2`), and `substring`'s numeric args.
5. Long `-----` chains could overflow the parser stack, the same exposure as deeply nested brackets. Add a depth limit with a clear parse error, red-first.

Also, HEL-1301 residue: throwaway user 21d2ffee-a560-47e5-a97b-e370153ac6c9 (skeptic-hel1403-…@example.test) remains in dev. Its pipeline and source were already deleted by id.

## Premise validation (orchestrator, 2026-10-12, origin/main 8e18ed545)

- Item 1: the boolean half is already fixed by HEL-1070. `ExpressionTypeInference.TextLike` includes `boolean`, so `$b + 1` infers `string`. Only the string-body half remains.
- Item 2: still open.
- Item 3: HEL-1436 has landed (df5c941e6). What remains is the confirmation plus a regression test.
- Item 4: still open.
- Item 5: still open. The parser has no depth bound, for unary `-`, `not`, or parentheses.
- HEL-1502 (in flight) owns `TimestampParsing` and compute's date handling. This change must not edit them.

## Acceptance Criteria

Owner rulings (2026-10-12, escalation HEL-1455-1791871083471-abb081): 1 warn, 2 per-column, 4a warn, 4b non-blocking warning (not an analyze error).

1. `floor($sb + 1)` with `sb` a trusted `string-body` field returns a `numeric-op-on-text-field` warning. `floor($b + 1)` with a boolean still warns (regression test).
2. Type trust is tracked per column through `compute`. In CSV -> compute(writes `total`) -> compute `floor($price)`, the second step warns on `price`. A column written by a compute is still untrusted.
3. A test proves that cast `price` to `float` -> `floor($price)` is silent, and that a legacy/unsupported cast target stays untrusted. No production change.
4a. A trusted integer/float field given to `length`/`lower`/`upper`/`substring` (first argument) returns a non-blocking `text-function-on-numeric-field` warning. A text field as `substring`'s start/end returns `numeric-op-on-text-field`.
4b. A string literal in a numeric context (`"3" * 2`), or a number literal in a text function (`length(5)`), returns a non-blocking `literal-type-mismatch` warning. It is never a `validationError`.
5. Expression nesting deeper than 100 (unary `-`, `not`, brackets, call arguments), on the strict parser and on the legacy fallback alike, is a clear parse error, never a stack overflow. So is a parsed tree deeper than 200, such as a long flat operator chain. Every item is proven red-first.
2b. The join and lookup key type checks use per-side, per-column trust.
6. The new codes are added to the analyze response JSON schema, the frontend `AnalyzeWarningCode` union, and the helio-mcp types and descriptions.
7. HEL-1301 residue: user 21d2ffee-a560-47e5-a97b-e370153ac6c9 is deleted from dev by exact (id, email).
8. No edits to TimestampParsing or compute date handling (HEL-1502).
