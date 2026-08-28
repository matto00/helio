## 1. Engine: attribute step failures

- [x] 1.1 Add `StepExecutionException(stepId: String, stepKind: String, reason: String, cause: Throwable)`
      alongside the engine, with a `message` of the form
      `Pipeline execution failed at step <stepId> (<stepKind>): <reason>`.
- [x] 1.2 In `InProcessPipelineEngine.executeWithStepCounts`, recover each `step.evaluate` failure into a
      `StepExecutionException` carrying `step.id.value` and `step.kind`. Do not wrap an already-wrapped
      exception twice.
- [x] 1.3 Derive `reason` by allowlist: an `IllegalArgumentException`'s `getMessage`; for anything else a
      fixed non-descriptive string. Never `toString`, never the class name.

## 2. Run service: surface the attributed message

- [x] 2.1 In `PipelineRunService.run` (~:374), use the `StepExecutionException` message when the failure is
      one; otherwise keep today's constant. Keep the existing full-throwable server-side log unchanged.
- [x] 2.2 Do the same in `previewStep` (~:218).
- [x] 2.3 Confirm by reading the code that the same `errMsg` still fans out to the SSE `errorLog` event,
      `RunStatusResponse.error`, and `PipelineRunRecord.errorLog` — no surface is left on the old string.
- [x] 2.4 Leave `SparkJobSubmitter.scala:94` and `SparkJobSubmitterSpec` untouched — the Spark path is out
      of scope by design Decision 3a. Confirm the final diff touches neither.

## 3. Analyze-time validation hook

- [x] 3.1 Add `validateStepConfig(kind: String, config: String): Option[String]` to
      `PipelineAnalyzeService`, dispatched by kind, taking the **raw** config string (design Decision 7 —
      HEL-860 depends on seeing keys the typed decoder drops).
- [x] 3.2 Call it before the per-kind `infer*` dispatch; on `Some(msg)` set `validationError = Some(msg)`
      and return the identity schema.
- [x] 3.3 Compose multiple failures for one step into a single joined message (design Decision 7 corollary).
- [x] 3.4 `StringOpsStep.SupportedOperations`, `FillNullStep.SupportedStrategies`,
      `WindowStep.SupportedFunctions` (+ `FieldRequired`), `PivotStep.SupportedAggs` already drive their own
      error messages — only make them visible to the analyze service.
- [x] 3.4a `AggregateStep`, `GroupByStep`, `UnionStep`, `JoinStep` have no supported-value set: extract one
      per step, then rewrite **both** the runtime `match`/check **and** the hardcoded supported-values text
      inside the error message to be driven by it (design Decision 5). A new val alongside an unchanged
      match and an unchanged hardcoded message is not acceptable.
- [x] 3.5 Implement validators for the Decision 6 in-scope list only. Do not add field-existence or
      DataSource-existence checks.

## 4. Contract

- [x] 4.1 Update the analyze and run OpenAPI/schema definitions for the error-message shape and the
      `validationError` semantics.
- [x] 4.2 Run the schema-drift and OpenSpec hygiene checks.

## 5. Tests — measured, not asserted

- [x] 5.1 Run test: a genuinely failing pipeline (`stringops` with `operation: "regexExtract"`) returns a
      `422` whose message contains the step id, the string `stringops`, the rejected value `regexExtract`,
      and the supported name `extractRegex`. One test asserting all of them.
- [x] 5.2 Run test: a step failing with a non-`IllegalArgumentException` names step id and kind but leaks
      neither the throwable's message nor any package-qualified class name.
- [x] 5.3 Analyze test: `validationError` is non-empty for the `regexExtract` step and names `extractRegex`
      among the supported operations; `outputSchema` equals `inputSchema`.
- [x] 5.4 Analyze test: a valid `stringops` step still reports no `validationError` and the previously
      inferred `outputSchema`.
- [x] 5.5 Analyze test: at least one further in-scope kind (e.g. `fillnull.strategy`) is validated, proving
      the hook is not a `stringops` special case.
- [x] 5.6 Update only `PipelineRunRoutesSpec`'s exact-match assertions (:533, :634, :756). Do **not** touch
      `SparkJobSubmitterSpec` (:360, :367) — out of scope per Decision 3a; if it fails, that is a defect in
      the change, not expected churn. Re-run `HookRoutesSpec` :324 and `PipelineRunServiceSpec` :380's
      `should not include` assertions rather than reasoning about them.
- [x] 5.6a Establish AC5 ("existing successful runs are unaffected") by measurement: run the full backend
      suite and record that every pre-existing pipeline run/analyze test still passes, naming the suites.
- [x] 5.7 For each new test, capture a red-on-revert transcript by actually reverting the production change
      and re-running. If a test is edited after its transcript is captured, recapture it.

## 6. End-to-end MCP verification

- [x] 6.1 With the dev servers running, drive a genuinely failing pipeline through the MCP surface and
      capture the literal text a caller receives, for both the run error and `analyze_pipeline`'s
      `validationError`. A populated backend field is not sufficient evidence.

## 7. Prose-against-code audit

- [x] 7.1 Re-read every sentence in `proposal.md`, `design.md`, and the spec deltas that asserts something
      is unchanged, preserved, or backward-compatible, and verify each against the final diff. Correct any
      that the code contradicts.
- [x] 7.2 Re-check the ticket's acceptance criteria against the delivered tree and correct any staleness
      inline.
