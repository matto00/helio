# HEL-1109: Step card UIs for the three new steps

## Description

Step cards in the pipeline editor, following the op-wiring checklist (apply/infer parity, `allowedOps`, StepCard). AI steps should show their estimated cost before running.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- Each of the three steps (`convertformat`, `analyzewithai`, `generatetext`) is authorable in the UI.
- Each is authorable by an agent.
- The UI and the agent produce IDENTICAL configs for the same intent.

## Scope boundaries (driver-stated, verified against the tree)

- The op-menu rework (grouped, filterable palette replacing the flat `OpDropdown`) is HEL-1136 and comes AFTER this ticket. Do not build it; do not restructure `OpDropdown` beyond adding the three ops. HEL-1136 will move step groups to a backend-owned field, so do NOT introduce a frontend group mapping here.
- No migration. V107 already admits all four ops.

## Verified ground truth (premise validation, see evidence/premise-validation.md)

- `convertformat`: `{field, from, to, outputField?}`. `outputField` defaults to `field` and OVERWRITES IT IN PLACE. Only csv->json, json->csv, text->markdown, markdown->text are valid; anything else (including `from == to`) is a named 422 (`ServiceError.UnprocessableEntity`; 400 is reserved for an unknown step type or a config decode failure -- see standing constraint C1). `field` must be `string-body`; the output field is marked `string-body`. JSON cells must be strings (a number fails at run time with `json-non-string-value`).
- `analyzewithai`: `{inputField, instruction, outputSchema}`. `outputSchema` MUST be emitted as an ORDERED ARRAY of `{name, type}` -- order is contractual and an object would be re-sorted by spray-json. All three required; `outputSchema` must be non-empty. `inputField` must be `string` or `string-body`.
- `generatetext`: `{inputField, instruction, outputField}`, all three required non-empty. `outputField` deliberately does NOT default to `inputField`, so a generator cannot silently overwrite its own source.
- Write-path validation runs at `PipelineService.scala:1787` via `companion.validateRawConfig` on step create. Both AI steps therefore REJECT an incomplete/empty seed config. `convertformat` does NOT (its `pairError` returns `None` when `from`/`to` are absent). The create flow is asymmetric across the three ops.
- All three currently render via the read-only `unsupportedOpType` fallback (`stepNarrowing.ts:285`); nothing asserts `OP_TYPES` covers the backend registry.
- HEL-1108: AI steps are never auto-runnable (`ai-step` reason code) and an over-cap call fails the run with `ai-quota-exceeded`. There is no dedicated frontend surface for either.
- `costVerdict` (`autoRunnable`, `estimatedRows`, `stepCount`, `reasons[]` with per-step `stepId`) is ALREADY on the non-concise `analyze` response and ALREADY typed in the frontend (`types/pipelineStep.ts:522-544`), with zero non-test UI consumers.
