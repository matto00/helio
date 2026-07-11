## Why

The Compute step's evaluator already parses arithmetic and string-concat with bare identifiers,
but the syntax is undocumented and ambiguous, has no string functions, and a bad expression
silently yields `null` per-row with no visible error path. HEL-262 formalizes the grammar and
closes the multi-column/string-op gaps.

## Recommendation (open design questions — human-approved)

1. **Require `$`** for column refs. 2. **Function-call syntax** (`concat`, `substring`, `lower`,
`upper`, `length`). 3. **Type coercion:** numeric ops strict (`TypeError` on non-numeric
operands); `+` permissive (string coercion, as today). 4. **Error surfacing:** render
`validationError` inline under the expression input.

## What Changes

- Require `$`-prefixed identifiers for column refs; live validation rejects bare identifiers.
- Add string functions via function-call syntax: `concat`, `substring`, `lower`, `upper`, `length`.
- Infer compute output `type` from the expression AST instead of a hardcoded frontend default.
- Surface `validationError` inline in `ComputeFieldConfig`.
- Publish one grammar doc referenced by both the engine and the frontend hint UI.
- **BREAKING (no data migration)**: existing persisted bare-identifier expressions keep *running*
  via a legacy-grammar fallback scoped to row-execution only; live validation flags them so users
  are nudged to update, without a data rewrite or blocked saves (design.md Decision 4).

## Capabilities

### New Capabilities

- `compute-expression-language`: shared grammar (literals, `$col` refs, operators, functions,
  coercion rules) as the documented contract both engine and UI implement.

### Modified Capabilities

- `pipeline-compute-op`: `$`-required refs, function-call syntax, output-type inference, inline
  error rendering in `ComputeFieldConfig`.

## Impact

- `backend/.../domain/ExpressionEvaluator.scala` (grammar rewrite; strict `validate()` +
  legacy-tolerant `evaluate()`/`validateTolerant()`)
- `backend/.../domain/PipelineAnalyzeService.scala` (`inferCompute` validation + type inference)
- `frontend/.../ComputeFieldConfig.tsx` (error display, `$` hint)
- `DataTypeService.scala`/`SourceService.scala` (DataType computed fields): behavior unchanged —
  switch to `validateTolerant`/`evaluate` to keep saves and execution working as today; not
  gaining `$`-required grammar in this ticket (see design.md Decision 4, Non-Goals)
- No Flyway migration — no persisted data is rewritten (see design.md Decision 4)
- `feedback_pipeline_op_wiring`: apply/infer parity via shared entry points; no new op added, so
  `allowedOps`/StepCard registration is unaffected

## Non-goals

- Autocomplete for column references (ticket's stated stretch goal, not required here).
- Boolean/comparison operators, conditionals, or aggregate functions in compute expressions.
- Tightening DataType computed-fields validation to `$`-required (follow-up ticket if desired).
