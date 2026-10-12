## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 50c9b2299b603f8d82f9333955e84093becbaadd (the change dir is still untracked). I judged the plan within the owner's rulings Q1 = error and Q2 = copy-only.

### What I verified (with evidence)

- **Premise, item 1.** `PipelineNodeReads.validateExpression` (PipelineNodeReads.scala:165-184) calls only `ExpressionEvaluator.validate(expression, fieldNames)`. `ColumnSchemaInference.inferCompute` (ColumnSchemaInference.scala:53-87) calls `validate` and then `inferType`. Confirmed.
- **Premise, item 2.** `RunConfigGate.stepConfigReasons` (RunConfigGate.scala:18-20) reads only `PipelineAnalyzeService.stepConfigProblem`, the raw-config check. The scheduler (PipelineSchedulerService.scala:207) and the auto-run trigger (AutoRunTriggerService.scala:107) use it. The analyze verdict turns every `validationError` into `step-config-invalid` (PipelineAnalyzeReads.scala:186). So class B, the analyze-only errors, are not gated. Confirmed.
- **Old copy locations.** The old copy appears only in denyReasonCopy.ts:57, denyReasonCopy.test.ts:58 and PipelineDetailFooter.stepConfigInvalid.test.tsx:50. Nothing in e2e or docs matches. The grammar doc's paragraph at docs/compute-expression-grammar.md:332 already says "display only", so task 4.1 has little to reword there.
- **Spec delta for run-to-update-affordance.** The delta keeps the main requirement's header and all three existing scenarios, and adds one scenario. Consistent.
- **How analyze builds a compute step's `validationError`.** `PipelineAnalyzeService.analyzeNodes` (PipelineAnalyzeService.scala:283-287) runs `validateStepConfig(op, config)` FIRST. Only when that returns `None` does it call `inferOutputSchema`, which leads to `inferCompute`. For compute, `validateStepConfig` reaches `ComputeStep.validateRawConfig` (ComputeStep.scala:98-104), which returns `s"compute: invalid expression: $m"` where `m = ExpressionEvaluator.parseProblem(expr)`. It also reaches `requiredConfigProblems` (ComputeStep.scala:115-120). `parseProblem` (ExpressionEvaluator.scala:120-125) falls back to the legacy grammar's message on a `$`-prefix error. The strict `validate` (line 155) does not.
  - Consequence: for an unparseable expression, analyze reports `compute: invalid expression: <parseProblem msg>`. `validate`, the planned shared function's first step, returns the bare strict-parser message. These are two different strings, and when the `$`-prefix fallback applies they can have different underlying text too.
  - This is not a flaky reading: it follows deterministically from the code paths cited above.
- **Response shape and seam plan.** D4 reuses a backend-committed fixture read by a frontend test. The repo has a precedent for this: `readFileSync` of a committed fixture in chartTimeAxis.test.ts. Sound.
- **Concurrent lanes.** The change touches no file under RunConfigGate, AutoRunTriggerService, PipelineSchedulerService, PipelineRunService or the cast step. C2 is consistent with the tasks.

### Verdict: REFUTE

The plan is close. There is one real contradiction between the spec delta and the design, and the planned test cannot detect it.

### Change Requests

1. **The spec delta promises exact analyze parity for ALL errors, but the D2/D3 design only delivers it for the inferCompute subset.**
   - specs/pipeline-validate-expression-api/spec.md says the verdict "SHALL be exactly the one pipeline analyze gives a `compute` step" and that "when analyze would report a `validationError` for that expression, `error` SHALL be that same message". That covers syntax errors.
   - Analyze's compute `validationError` for an unparseable expression comes from `StepConfigValidation`, through `ComputeStep.validateRawConfig`, with the `compute: invalid expression: ` prefix and the `parseProblem` legacy fallback. It never comes from `inferCompute`.
   - D2's shared function is `validate` then `inferType`, so the endpoint will return a different parse-error string than analyze. D3's oracle is `inferCompute`, not analyze, so the parse-error row of the parity table will pass while the spec's literal claim is false. That is a green check that proves nothing.
   - Revise so that one of these holds:
     - (a) The shared function reproduces what analyze actually does for a compute step: `stepConfigProblem("compute", <synthetic config>)` and then the inferCompute check. D3's oracle then becomes `PipelineAnalyzeService.analyzeNodes` (or `analyze`) on a one-compute-step pipeline at that schema, not `inferCompute`.
     - (b) The spec delta is narrowed so the exact-message parity claim covers unknown-field and type errors only, and states that syntax errors are `valid:false` with the parser's message, whose wording may differ from analyze's.
   - Either option is fine within Q1. Pick one and make spec, D2, D3 and task 2.1 agree.
   - If you choose (a), name how the synthetic config handles `column` (it must be non-empty, or `requiredConfigProblems` reports a missing column). Also name how a blank expression is treated: analyze reports a missing expression, while `validate("")` reports a parse error.

2. **The D3 oracle must match the spec's stated oracle.** Whatever CR1 resolves to, the parity test should compare against the same surface the spec names. The spec currently names analyze's compute-step `validationError`; the test currently uses `inferCompute`. Make task 2.1 name that oracle explicitly, so the evaluator can check that the test exercises the real analyze path.

### Non-blocking notes

- **Class A table row.** The design's claim that a class-A manual run fails with 422 `STEP_CONFIG_INVALID` is not exercised by D6, which reproduces only class B. The D5 copy ("wrong or missing") holds either way, so this does not block. Just don't present the class-A row as live-verified.
- **Task 4.1.** The grammar doc's :332 paragraph already calls the notice "display only". Rewording mainly means updating "The pipeline page's step-config-invalid notice that follows" so it reflects the new copy. The validate-expression contract addition is the substantive part of 4.1.
- **Main spec Purpose line.** The main spec's Purpose still says "compute/filter expression", and its old requirement text mentions `compute`/`filter`/`assert`. Only compute uses `ExpressionEvaluator` on the analyze path. The modified requirement drops this, which is fine; optionally tidy the Purpose line in the archive sync.
