# HEL-1404: Split ExpressionEvaluator.scala (~724 lines): tokenizer, parsers+AST, type inference, evaluation/dispatch

## Description

origin_kind: followup
origin_ticket: HEL-1315

`backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala` is ~724 lines after HEL-1315, well over
CONTRIBUTING.md's ~400. Behaviour-preserving split along its concerns: tokenizer; strict and legacy parsers plus the
AST; type inference (keep the `NumericFunctions` list shared by inference and the parity test); evaluation and function
dispatch. Same proof standard as the 2026-10-08 splits (HEL-1253/1187/1234): moved code byte-identical, public API diff
empty, no test changes beyond imports.

## Acceptance Criteria

1. `ExpressionEvaluator.scala` is split along its concerns (tokenizer; strict + legacy parsers and the AST; type
   inference; evaluation and function dispatch) into focused files in `com.helio.domain.engine`.
2. Behaviour-preserving: moved code byte-identical (forward and reverse checked, with red runs).
3. Public API diff empty: synthetic-filtered `javap -public` of the entry-point classes unchanged (expected deltas
   predicted in design.md D6b, nothing else).
4. `NumericFunctions` (and `SupportedFunctions`) stay single-sourced, shared by type inference, function dispatch's
   arity check, and the parity test in `ExpressionEvaluatorSpec`.
5. No test-source changes beyond imports (target: zero test diff); `sbt testFull` totals and per-suite counts equal the
   baseline.

## Premise notes (Setup, 2026-10-09, origin/main 0f95ec49)

- File is now 741 lines (HEL-1423 #881 added `coalesce()` after filing).
- `coalesce`'s type rule is `ExpressionEvaluator.coalesceType`, called from `inferTypeOf`; it moves with type inference.
  `ColumnSchemaInference.inferCompute` (HEL-1385) only surfaces its `Left` as the analyze error and is not touched.
- Out of scope: HEL-1403 (unary minus / negative literals, queued after this), HEL-1070.
