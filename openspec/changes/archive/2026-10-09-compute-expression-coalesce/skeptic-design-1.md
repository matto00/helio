## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 0a4badcfb33d76ee02ca4be503fae761f1ed9f82. The change dir is untracked, so the artifacts are the only thing under review.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/compute-expression-coalesce-function/HEL-1423`.
- **Owner ruling:** `.concertino/runs/HEL-1423/events.jsonl` line 5 is `escalation.answered`, `answer: analyze-error`, `answer_source: human`. The question (line 4) warned that "analyze validationError feeds the auto-run gate". The code shows it does not (see D5 below), so the ruling's real impact is the same as what the owner was told or smaller. No re-escalation needed.
- **Design context claims (`ExpressionEvaluator.scala`, 724 lines):**
  - `SupportedFunctions` and `NumericFunctions` are at lines 211-216.
  - `checkArity` is at line 221. The strict parser calls it at line 293. Because `parseArgs` accepts an empty list, `coalesce()` will reach `checkArity` and produce the spec's message.
  - `inferTypeOf` is at line 476. `evalExpr` evaluates `Call` arguments eagerly at line 584.
  - `applyFn` starts with `if (args.contains(VNull)) Right(VNull)` at line 620.
  - `FieldRef` maps a JsBoolean or other value to `VStr`.
  - All of this matches the design.
- **D4 (only the new branch is reached):** `inferCompute` (`PipelineAnalyzeService.scala:550-572`) calls the strict `validate` (parse plus `checkRefs`) before the strict `inferType`. Both use the same `parse` and the same field-name set. That means an inferType `Left` is unreachable today. The legacy-grammar mismatch I looked for does not exist: both calls are strict. The only effect of D4 is the new coalesce error. The error branch keeps `column` in the projected schema, so outputs bound downstream are not orphaned. That matches the fallback of the existing `validate`-Left branch.
- **D5 (run gating), checked in code:**
  - `RunConfigGate.stepConfigReasons` only calls `PipelineAnalyzeService.stepConfigProblem(kind, rawConfig)` and never reads a schema (`RunConfigGate.scala:10-24`).
  - Its callers are `AutoRunTriggerService.scala:107` and `PipelineSchedulerService.scala:268`.
  - Compute's save and config problems are `parseProblem` only (`ComputeStep.scala:103,119`).
  - The only server consumer of analyzed `validationError` that affects gating is `PipelineService.toCostVerdictResponse` (`:1071-1087`), and it is response-only.
  - The other consumers don't gate anything:
    - `AnalyzeSchemaWarnings:102,127` suppresses warnings.
    - `UpsertTargetAnalysis` overlays the error.
    - `WorkspaceContextService:339` passes it through.
  - Frontend: in `PipelineDetailFooter.tsx`, `costVerdict.canRun` only hides the "Run to update" button inside the denial block (line 148). The main Run and Dry-run buttons are disabled only on `runStatus` queued/running (lines 318, 327).
  - **Conclusion: D5 is correct.** The analyze error does not block scheduled runs, dataset-write auto-runs or manual runs.
- **D4 rendering:** `ComputeFieldConfig.tsx:84` renders the analyze `validationError` through `InlineError`.
  - Separately, `POST .../validate-expression` (`PipelineService.scala:1292`) only calls `validate`, so it will not report the mixed-type error. As far as I can tell that endpoint feeds the Output editor (`outputService.ts:267`), not the compute step card, so it is not a gap for this AC.
- **Ripple from the message change:** grep for `supported functions` / `ceil, concat` found:
  - exact or substring assertions in `ExpressionEvaluatorSpec:78`, `PipelineAnalyzeServiceSpec:309` and `ComputeStepSpec:98`
  - a marker-only match in `PipelineCreateStepConfigRoutesSpec:110`
  - the docs example at `compute-expression-grammar.md:121`
  - Frontend hits were only `WindowConfig` (unrelated window functions).
  - All of these are covered by D1, D8 and tasks 2.5/3.1.
  - `ExpressionEvaluatorSpec:752` also asserts `SupportedFunctions should have size 10`. It will fail loudly and must become 11 (see notes).
- **D6 parity test:** `ExpressionEvaluatorSpec:715-721` asserts `NumericFunctions == SupportedFunctions -- stringFns`. Adding coalesce breaks that equality unless it is classified separately, which is exactly what D6 plans.
- **Production callers of ExpressionEvaluator:** grep of `backend/src/main` shows only `PipelineAnalyzeService` and `ComputeStep`. No DataType or computed-field path picks up coalesce by accident.
- **Spark path:** `SparkJobSubmitter.scala:246` uses `F.expr(expression)`, a pre-existing divergence that was declared a non-goal. Spark SQL does have `coalesce`, so this change does not make the divergence worse.
- **AC coverage:**
  - AC1 (semantics, common-type inference, HEL-1315 list/parity pattern): D1-D3, D6 and tasks 2.1-2.3.
  - AC2 (red-first concat → null, coalesce form → string): spec CSV scenario, D7, tasks 1.1-1.2 and 4.2.
  - AC3 (docs and spec): D8, task 3.1 and the spec delta.
  - No task falls outside the ACs. There is no API, schema or migration change, so no contract delta is needed.
- **Self-approved decisions:**
  - **Arity ≥ 2 as a parse error:** sound. It is consistent with the per-function arity errors and costs nothing, since no existing data uses coalesce.
  - **Left-to-right short-circuit, exempt from null propagation:** sound. It is SQL-faithful, handled before the eager fold so it never reaches `applyFn`'s guard, and the spec pins it with the unreached-`floor($s)` scenario.
  - **Error in a reached argument nulls the row:** sound. `ComputeStep.apply:71-73` already maps any eval `Left` to `null`, so this is the existing contract, not a new one.
- **Placeholders, contradictions, ambiguity:** none blocking. No TODO/TBD. Tasks follow the design one-to-one, and every task names a verification signal.

### Verdict: CONFIRM

### Non-blocking notes
- `ExpressionEvaluatorSpec:752` (`should have size 10`) must become 11. Fold it into task 2.5 explicitly; right now 2.5 only mentions "exact-message assertions".
- The spec delta's inference requirement still opens with "a result type (the canonical wire values `"float"` or `"string"`)". The new coalesce clause can return the shared argument type (e.g. `timestamp`, `boolean`, `integer`). This inaccuracy already exists for bare `$field`, but this change touches the sentence, so consider wording it as "a canonical `DataFieldType` wire value".
- D3 says each non-error result "names the runtime class truthfully". That is not true for same-type `boolean`, `timestamp` or `integer`, where the runtime value is a JSON string or a double. This matches today's bare-`$ref` behaviour (the design's Risks section admits it for integer). D6's "same-type" parity case should use `string` or `float` so the test is not asserting something false.
- The pipeline-page denial copy for `step-config-invalid` will say auto-run is denied while server-side auto-runs actually still fire. This is the existing HEL-1280 behaviour for schema-derived errors and D5 acknowledges it. Mention it in the docs inference section (task 3.1) so the "analyze-only" claim is not misread.
- D7(c) live red: on main, a coalesce save is rejected by `ComputeStep.validateRawConfig` → `parseProblem`. Capture the actual HTTP status and message rather than assuming it.
