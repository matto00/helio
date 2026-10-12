## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 50c9b2299b603f8d82f9333955e84093becbaadd. The change dir is untracked. I judged the plan within the owner's rulings: Q1 = error, Q2 = copy-only.

### What I verified (with evidence)

- **Round-1 CR1 (option a): the composition matches the real analyze path.**
  - `PipelineAnalyzeService.analyzeNodes.processNode` (PipelineAnalyzeService.scala:284-289) runs `validateStepConfig(op, config)` for an enabled step. Only when that returns `None` does it call `inferOutputSchema(op, config, inputSchema, secondarySchema)`.
  - D2's formula, `validateStepConfig("compute", cfg).orElse(inferOutputSchema(...)._2)`, is the same composition. Compute has no lane or source dependency, so `secondarySchema=None` is equivalent.
- **Synthetic config handling.**
  - `StepConfigValidation.validateStepConfig` (StepConfigValidation.scala:23-75) takes the `validateRawConfig` shape rejection first.
  - For a non-blank unparseable expression, that rejection is `compute: invalid expression: <parseProblem>` (ComputeStep.scala:98-104).
  - Otherwise it calls `requiredConfigProblems` (ComputeStep.scala:115-120), which yields `compute step is missing required config value 'expression'.` for a blank expression (StepCodecUtil.scala:185-189). D2's claim about blank expressions is correct.
  - A non-empty `column` suppresses the missing-column message.
  - `inferCompute` (ColumnSchemaInference.scala:53-87) returns `validate`/`inferType` messages or the fixed "compute config error". None of the messages embed the column name.
  - An expression that is legacy-parseable but strict-invalid (a bare identifier) falls through to `inferCompute`'s strict `validate` in both analyze and the new function, so parity holds by construction.
- **Round-1 CR2: oracle alignment.**
  - The spec delta names analyze's compute-step `validationError` as the oracle.
  - D3 and task 2.1 name `analyzeNodes` on one enabled compute step.
  - The D3 table includes the parse-error and blank rows, which were the ones that diverged on main.
- **Endpoint wiring.** `PipelineNodeReads.validateExpression` (PipelineNodeReads.scala:165-184) currently calls only `ExpressionEvaluator.validate` against `projectedSchemaAtNode`. The plan swaps only that call and keeps the 404/shape behaviour.
- **Seam precedent.**
  - `PipelineAnalyzeCanRunRoutesSpec.scala:108` reads `src/test/resources/analyze/step-config-invalid-cost-verdict.json`.
  - `PipelineDetailFooter.stepConfigInvalid.test.tsx:15` reads the same file.
  - The D4 pattern is real. The client's `outputService.validateExpression` (outputService.ts:272-283) normalises a null `error` to `undefined`, as D4 states.
- **Old copy sites.** grep for "can't run until" over frontend/src, e2e and docs finds exactly denyReasonCopy.ts:57, denyReasonCopy.test.ts:58 and PipelineDetailFooter.stepConfigInvalid.test.tsx:50. Task 3.1 covers all three.
- **Spec deltas.** pipeline-validate-expression-api now claims exact parity, and the design delivers it. The run-to-update-affordance delta keeps all existing scenarios and adds the copy scenario. Both are consistent with D5 and C2.
- **AC coverage.**
  - AC1 (type-error parity, including the HEL-1070/HEL-1314 rows, plus the seam test) is covered by tasks 2.1-2.3.
  - AC2 (accurate copy, reproduced live first) is covered by 1.1, 3.1-3.2 and 4.2.
  - AC3 (red-first tests) is covered by 2.1 and 3.1.
  - No scope drift into run gating (C2).

### Verdict: CONFIRM

### Non-blocking notes

These are stale leftovers from the pre-revision design. Fix them before archive so that the evaluator and future readers do not follow them:
- design.md, Risks, bullet 2, still says "D2/D3 compare against `inferCompute` itself". It should say they compare against analyze (`analyzeNodes`), which is what D3 and task 2.1 now name.
- proposal.md, Impact, lists "`ColumnSchemaInference.inferCompute` (re-pointed to the shared check)" and "`ExpressionEvaluator` or a sibling engine object (the shared check)". D2 instead puts the function on `PipelineAnalyzeService` and states that `inferCompute` is unchanged. Align the Impact list.
- The class-A row of the design table (manual run fails with 422) remains un-exercised by D6. The note from round 1 still applies: do not present that row as live-verified.
- Task 2.2's "ideally a helper shared with `processNode`": also consider the linear `analyze` (PipelineAnalyzeService.scala:120-123), which has the same composition. Sharing one helper across both would make the "exists once" claim fully true. This is optional.
