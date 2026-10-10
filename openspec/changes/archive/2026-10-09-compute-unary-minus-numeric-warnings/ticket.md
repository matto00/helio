# HEL-1403: Compute expressions: unary minus / negative literals, and analyze-time warning for numeric functions on string fields

## Description

origin_kind: followup
origin_ticket: HEL-1315

From HEL-1315 (569fda061, which added floor/ceil/round/mod/abs):

1. The grammar has no unary minus, so negatives must be written `0 - x`, which is awkward with the new functions (e.g. `mod(0 - 7, 3)`). Add unary minus and negative literals to the strict parser, with type inference and evaluation parity, and update `docs/compute-expression-grammar.md`.
2. `floor($stringField)` (and `$s - 1`) infers `float` at analyze time, then nulls every row at run time with a per-row TypeError. Analyze could warn when a numeric function or arithmetic operand is a known string-typed field (e.g. an uncast CSV column), suggesting a cast step. It should warn, not fail, consistent with HEL-1235's analyze-warning work.

Priority: Low. Labels: Follow-up. Related: HEL-1235, HEL-1315, HEL-1423.

## Acceptance criteria (derived from the ticket text and the driver brief)

- AC1: The strict compute grammar accepts unary minus / negative literals (`-5`, `-$x`, `mod(-7, 3)`, `2 - -3`, `-floor($x)`, `round($x, -2)`), with type inference and row-evaluation parity; the binding of `-` against `*`/`/`, function calls and repeated `--x` is decided and documented in `docs/compute-expression-grammar.md` (and the "no unary minus" known limitation removed).
- AC2: The legacy (bare-identifier) parser's treatment is stated explicitly.
- AC3: Red-first tests for unary minus at unit level AND through a real pipeline run.
- AC4: The Spark path (`SparkJobSubmitter`, `F.expr` pass-through) is checked for unary-minus consistency, or the difference is documented.
- AC5: Analyze emits a NON-BLOCKING warning (HEL-1235 plumbing: `warnings`, never `validationError`, never `canRun=false`, never the RunConfigGate / auto-run gate) when a numeric function argument or arithmetic (`-`/`*`/`/`, unary `-`) operand is a known non-numeric (string-typed) field, e.g. an uncast CSV column, suggesting a cast step.
- AC6: Contract surfaces stay in sync for the new warning code (JSON schemas, frontend type, helio-mcp types/tool descriptions, specs).
- Out of scope: HEL-1436 (CastStep float/timestamp fall-through — interaction noted only), HEL-1070 (conditionals).
