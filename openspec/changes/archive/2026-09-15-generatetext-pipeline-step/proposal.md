## Why

`generatetext` is the last genuinely-unregistered pipeline op and the third AI/file step of epic HEL-1103.
V107 already admits the op string and `PipelineCostEstimator.AiOps` already classifies it as `ai-step`, but it
has no `PipelineStep.Registry` entry — so a persisted `generatetext` row makes `rowToDomain` throw and
`analyze` 500 instead of returning a schema. The narrative case (free text synthesized from row data) has no
step today.

## What Changes

- New `generatetext` op: for each row, send an instruction plus a declared input field's content to Claude
  through the existing `AiStepClient` seam (HEL-1106), and write the model's response text to a declared
  output column typed `string-body`.
- **Per-row, one model call per row** (owner ruling): mirrors `analyzewithai`; no N-to-1 collapse and no mode
  toggle for one. The collapse variant is deferred.
- Unlike `analyzewithai`, the response is **free text** — there is no declared output schema and no JSON
  parsing or enforcement. The only response-level failure is an empty/blank response.
- `analyze` reports the output column as `string-body` without calling the model, making it a bindable column
  at the node. Token budgets stay with `ClaudeClient`'s existing clamps — never re-implemented here.
- Full registration: registry, `PipelineStepKind`, codec, `rowToDomain`, analyze inference and response,
  domain aliases, helio-mcp op docs.

## Capabilities

### New Capabilities
- `pipeline-generatetext-op`: config, per-row free-text generation through the AI seam, `string-body` output
  column, named failure reasons, and analyze parity.

### Modified Capabilities
- None. Analyze parity for the new op is specified inside `pipeline-generatetext-op`, as HEL-1105/1106 did.

## Non-goals

- The markdown-Output render path and any `OutputBindingSpec.Markdown` slot change — original AC1 restated by
  owner ruling; narrative rendering stays with HEL-921. The existing markdown bound-Content defect is filed
  separately.
- Tier gating / never-auto-run (HEL-1108); step card (HEL-1109); op palette (HEL-1136).
- Any `AiOps` reclassification or migration — both already in place.

## Impact

Backend: `domain/steps`, `domain/model/PipelineStep.scala`, codec, repository `rowToDomain`, analyze service
and protocol, `PipelineService`, `domain/package.scala`. helio-mcp: `add_pipeline_step` op docs. Six pinned
test surfaces enumerate the registry and must be updated deliberately. No frontend change (unsupported-op
fallback applies). No new dependencies, no migration.
