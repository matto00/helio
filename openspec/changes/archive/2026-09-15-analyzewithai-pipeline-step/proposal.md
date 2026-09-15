## Why

`analyzewithai` is the first AI pipeline step (design spec section 6). V107 already admits the op and
`PipelineCostEstimator.AiOps` already classifies it, but it is not registered, so a persisted step makes
`rowToDomain` throw and analyze 500. Downstream steps need a real schema from config, not one inferred
from row 0 (HEL-891), and a model response must never silently yield partial columns.

## What Changes

- New `analyzewithai` op: for each row, send a declared content field plus an instruction to Claude via the
  existing `com.helio.ai.ClaudeClient`, parse a strict JSON object, and append the declared output columns.
- Config declares `outputSchema` (ordered name/type list); analyze returns that as the real output schema.
- Strict response enforcement: malformed JSON, trailing content, missing field, wrong type, and extra
  fields each fail the step with a named reason code. The row is never partially emitted.
- A reusable client seam (`AiStepClient` on `PipelineExecutionContext`) wired from `ClaudeConfig.fromEnv()`
  in `ApiRoutes`. With no `ANTHROPIC_API_KEY`, the step fails with a named `ai-unavailable` reason and
  the backend still boots. One call point is left for HEL-1108 tier gating.
- Full registration: registry, codec, `rowToDomain`, analyze inference and response, schemas.

## Non-goals

- `generatetext` (HEL-1107): it reuses the seam but is not implemented here.
- Tier gating / `HELIO_BETA_DAILY_MESSAGE_LIMIT` and never-auto-run (HEL-1108).
- StepCard editor (HEL-1109) and op palette (HEL-1136); no migration; no cost reclassification.

## Capabilities

### New Capabilities
- `pipeline-analyzewithai-op`: config, AI client seam, declared output schema, strict response enforcement.

### Modified Capabilities
- None (analyze parity for the new op is specified inside `pipeline-analyzewithai-op`, as HEL-1105 did).

## Impact

Backend: `domain/steps`, `domain/model/PipelineStep.scala`, engine context, `PipelineRunService`,
`ApiRoutes`, codec, repository, analyze service and protocol, JSON schemas (only if they enumerate ops).
helio-mcp: `add_pipeline_step` op docs in `helio-mcp/src/tools/write.ts` gain `analyzewithai` (plus the omitted `convertformat`). No frontend change is expected
(the unsupported-op fallback applies). No new dependencies.
