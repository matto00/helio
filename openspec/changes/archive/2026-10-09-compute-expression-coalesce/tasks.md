## Standing Constraints

## 1. Tests first (red)

- [x] 1.1 Add `ExpressionEvaluatorSpec` cases for every spec scenario (validate/arity, evaluate, inferType, parity per D6) and run them; record the red transcript (`'coalesce' is not a recognized function`)
- [x] 1.2 Add a CSV-blank pipeline-level spec (`CsvLoadSupport` real loader + `compute` step) asserting concat-only → `Ada Lovelace`/null/null and the coalesce form → `Ada Lovelace`/`Grace `/` Hopper`; record red
- [x] 1.3 Add `PipelineAnalyzeServiceSpec` cases: mixed-type coalesce → step `validationError` naming coalesce; same-type → no error and inferred type; record red

### Backend

## 2. Implementation

- [x] 2.1 `ExpressionEvaluator`: add `coalesce` to `SupportedFunctions` (alphabetical) and `checkArity` (≥ 2); verify 1.1 arity/list tests pass
- [x] 2.2 `ExpressionEvaluator.evalExpr`: lazy short-circuit `coalesce` branch before the eager fold (D2); verify evaluate tests pass
- [x] 2.3 `ExpressionEvaluator.inferTypeOf`: common-type rule + mixed-type `Left` (D3); verify inference + parity tests pass
- [x] 2.4 `PipelineAnalyzeService.inferCompute`: surface an `inferType` `Left` as `validationError` (D4); verify 1.3 passes
- [x] 2.5 Update the exact-message assertions (ExpressionEvaluatorSpec, PipelineAnalyzeServiceSpec, ComputeStepSpec if any) for the new supported-functions list, incl. the `SupportedFunctions` size assertion 10 → 11 (ExpressionEvaluatorSpec ~752); verify they pass

### Docs

## 3. Docs and spec

- [x] 3.1 Update `docs/compute-expression-grammar.md` per D8; verify by grep that `coalesce` appears in the table, Errors example, inference section and null-propagation paragraph
- [x] 3.2 Grep helio-mcp/assistant prompts for compute-function enumerations; update any found or record the zero-hit grep

### Tests

## 4. Verification

- [x] 4.1 Run `ExpressionEvaluatorSpec`, `PipelineAnalyzeServiceSpec`, `ComputeStepSpec`, the new CSV spec, and the full backend suite (`testFull`, worktree project path verified)
- [x] 4.2 Live run per D7(c) on this worktree's dev server with a throwaway user; save evidence (rows, analyze response, save status); delete residue by exact id
