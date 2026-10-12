## Context

See proposal.md (Why). Verified on main at 50c9b2299. Evidence: `.concertino/runs/HEL-1437/evidence/premise-validation.md`.

- `ColumnSchemaInference.inferCompute` (analyze, compute step) runs `ExpressionEvaluator.validate(expression, fieldNames)` and then, on success, `ExpressionEvaluator.inferType(expression, fieldTypes)`. A `Left` from either becomes the step's `validationError`.
  - `inferType` `Left`s now include the coalesce mixed-type rule (HEL-1423), HEL-1070's strict number-vs-text comparison, boolean/branch-type rules and `if()` branch types, and HEL-1314's date-function argument types.
- `PipelineNodeReads.validateExpression` runs only `validate` against the node's projected schema (`projectedSchemaAtNode`, which already carries field TYPES). Only compute uses `ExpressionEvaluator`, so the endpoint is in practice a compute-expression check.
- Compute save is parse-only (`ComputeStep.requiredConfigProblems` -> `parseProblem`), so it is schema-blind. An `Unknown field` expression is already `valid:false` here and still saves.
- No UI caller exists. `outputService.validateExpression` is exported but unused, and helio-mcp does not call the endpoint.
- The `step-config-invalid` reason is produced in two places:
  - `PipelineAnalyzeReads.toCostVerdictResponse` emits it for EVERY analyzed `validationError`, including the schema-derived ones (class B), and clears `canRun`/`autoRunnable`. That is the pipeline page notice.
  - `AutoRunTriggerService` emits it for `RunConfigGate` raw-config problems (class A). That is the auto-run denial toast.
- Both surfaces render `denyReasonCopy("step-config-invalid")`. What actually happens for each class:

  | Class | Manual run | Scheduled run | Dataset-write auto-run |
  | --- | --- | --- | --- |
  | A (raw-config) | fails with 422 `STEP_CONFIG_INVALID` | recorded-but-skipped | denied |
  | B (analyze-only) | runs | fires | fires |

  In class B the values may be null or wrong (HEL-1423 D5 verified this in code). Task 1 below re-confirms class B live. The class-A manual-run 422 is verified in code only (`PipelineRunSupport.executionFailureError`), not live, and is not claimed as live-verified. The new copy is true either way.

## Goals / Non-Goals

**Goals:** endpoint/analyze parity for compute expression errors by construction, not by copying code; copy that is true for both classes.

**Non-Goals:**
- Any change to run gating, the analyze cost verdict, `canRun` or `autoRunnable` (owner Q2 = copy-only).
- Surfacing analyze's non-blocking schema WARNINGS (numeric-op-on-text) through the endpoint.
- A response shape change (owner Q1 = error).
- Splitting the reason code.
- Wiring a UI caller for the endpoint.

## Decisions

**D1 (owner ruling Q1 = `error`): type errors are reported as `valid:false` with analyze's exact message.**
- The shape stays `{valid, error?}`.
- `valid:false` keeps its existing meaning ("analyze would flag this"), which already includes the saveable `Unknown field` case. It never meant "save rejects".
- No draft becomes unsaveable, because save never consults this endpoint.
- Rejected alternatives:
  - `warning`: a new `warnings[]` field, which is a shape change and would break parity with analyze, which calls these errors.
  - `error-with-flag`: a new `saveBlocking` field. No caller needs it today, and adding it later is backward-compatible.

**D2: one shared engine function that IS analyze's compute-step check (design-gate round 1, REFUTE item 1, option a).**
- For an enabled step, analyze's walk (`PipelineAnalyzeService.analyzeNodes` -> `processNode`) runs `validateStepConfig(op, config)` first. Only when that returns `None` does it run `inferOutputSchema(op, config, inputSchema, ...)`, which for compute is `inferCompute`.
  - So an unparseable expression's analyze error comes from `ComputeStep.validateRawConfig` (`"compute: invalid expression: " + parseProblem(...)`, legacy-grammar fallback message), not from `ExpressionEvaluator.validate`.
- Add ONE public engine function on `PipelineAnalyzeService`, e.g. `computeExpressionProblem(expression: String, inputSchema: Vector[SchemaField]): Option[String]`. It builds a synthetic compute config and returns exactly what `processNode` would set as `validationError` for an enabled compute step with that config and input schema: `validateStepConfig("compute", cfg).orElse(inferOutputSchema("compute", cfg, inputSchema, None)._2)`.
  - Preferably `processNode`, the linear `analyze` path (PipelineAnalyzeService.scala ~120-123) and this function all share one private helper, so the composition exists once.
- The synthetic config is `{"column":"__validate_expression__","expression":<expression>}`, built with spray-json so quoting is correct. There is no `type` key, which is the same as a stored step with no type hint.
  - A non-empty `column` means the only problems that can surface are about the expression. The column name never appears in any message.
  - The executor must verify that last point by grepping the messages `requiredConfigProblems`/`validateRawConfig`/`inferCompute` can produce. If a message ever embeds the column, choose a column that cannot collide and note it.
- A blank or whitespace-only expression gets whatever analyze reports for a compute step with a non-empty column and that expression. That is `requiredConfigProblems`' missing-expression message, so the endpoint answers `valid:false` with that message. Today's endpoint behaviour for a blank expression is captured in 2.1's red run, and the change is called out in the PR.
- `PipelineNodeReads.validateExpression` calls this function with the node's projected schema (`projectedSchemaAtNode`, which is unchanged).
- `inferCompute` itself is unchanged: it is still what analyze runs, and the new function calls through it.
- Rejected alternatives:
  - Calling `validate` then `inferType` inline: the design-gate REFUTE showed it diverges from analyze on parse errors.
  - Narrowing the spec (option b): parity by construction is cheaper than documenting an exception.

**D3: a parity test against analyze itself (REFUTE item 2).**
- The oracle is `PipelineAnalyzeService.analyzeNodes` on a single enabled compute step (`NodeStepInput` with that expression and a fixed column) over a fixed typed root schema, reading that step's `validationError`.
- A backend test asserts, row by row, that the endpoint's `error` (through the route or the service) equals the oracle's `validationError` (`None` <-> `valid:true`).
- The table has at least one of each:
  - valid
  - unknown field
  - parse error (the row that diverges on main)
  - blank expression
  - coalesce number/text
  - comparison number-vs-text (HEL-1070)
  - `if()` branch mismatch
  - date-function type error (HEL-1314)
  - a boolean/non-boolean coalesce mix
- On unchanged code, every row whose endpoint verdict differs from the oracle must be red. The red output is saved to evidence.

**D4: seam test.**
- The backend route spec writes or asserts the real endpoint response for one type-error expression against a committed fixture, `backend/src/test/resources/validate-expression/type-error-response.json`. This follows the HEL-1266 `step-config-invalid-cost-verdict.json` pattern: the spec compares the real response to the committed file, so drift fails it.
- A frontend test (`outputService` validateExpression) mocks `httpClient.post` with that same fixture file and asserts `{valid:false, error:<fixture text>}` is returned (null/absent error normalised to `undefined` as today).
- Either side drifting turns one test red.

**D5 (owner ruling Q2 = `copy-only`): the new copy.**
- The text is exactly: "A step in this pipeline has a problem, so its results may be wrong or missing until that step is fixed."
- It is true for class A (results missing: the run fails or is skipped) and class B (results may be wrong).
- It is shared by the page notice and the auto-run toast; both remain accurate.
- Update in the same change:
  - the existing tests that pin the old string (`denyReasonCopy.test.ts`, `PipelineDetailFooter.stepConfigInvalid.test.tsx`, plus any others found by grepping "can't run until");
  - the `run-to-update-affordance` spec;
  - the grammar doc paragraph.
- A test asserts that the copy does not match `/can.?t run|cannot run/i`. It is red on main.
- `denyReasonCoverage.test.ts` must stay green.

**D6: live reproduction (driver requirement, before the copy change is claimed accurate).**
- The executor runs this on the worktree dev server (ports 6869/9776) with a throwaway `@example.test` user, registered and verified via `/api/auth/me`.
- Steps:
  1. Upload a small CSV with a numeric column.
  2. Create a pipeline with a compute step `coalesce($n, "n/a")`. Capture analyze, which shows the `step-config-invalid` reason and `canRun:false`.
  3. Manual run: capture that it succeeds and capture `/api/outputs/:id/rows` or the run status.
  4. Call validate-expression with the same expression before and after the change (main returns `valid:true`, which is the live red).
  5. Optionally, set an interval schedule and observe one fire within two scheduler ticks. Delete the schedule afterwards.
- Residue is deleted by exact id. Evidence goes in `.concertino/runs/HEL-1437/evidence/`.

## Risks / Trade-offs

- [Callers that treated `valid:true` as "OK to save" now get `valid:false` for saveable expressions] → they already did for `Unknown field`. The spec states the meaning explicitly. No UI or MCP caller exists.
- [The `if()`/comparison messages change wording in a later HEL] → D2/D3 compare against analyze itself (`analyzeNodes`), not against literal strings, except for the one seam fixture. That fixture is chosen from a stable message, and regenerating it is a reviewed fixture edit.
- [Copy shared with the toast reads slightly less specific for class A] → accepted. Accuracy over specificity was the owner's choice.
- [Concurrent lanes] → HEL-1504 touches `PipelineRunService` and the debounce code, and HEL-1476 touches step configs (cast). This change touches neither, so the seams stay clean.

## Planner Notes

- Owner rulings (escalation HEL-1437-1791763050529-0a9d2d, answered via chat): Q1 `error`, Q2 `copy-only`.
- Design gate round 1 REFUTE (skeptic-design-1.md): D2/D3 re-based on analyze's actual composition (option a).
- Self-approved: the D5 wording (the recommended sentence in the escalation the owner accepted), the D2 shared-function approach, and the fixture path.
