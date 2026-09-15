## Why

V107 admits `convertformat` in the op CHECK, but nothing implements it: creating one returns 400 and any persisted row
would make `PipelineStepRepository.rowToDomain` throw. Pipelines need a deterministic way to move content between the
formats Helio already ingests (CSV, JSON, plain text, Markdown) so downstream steps and write-back can consume them.

## What Changes

- New `convertformat` step: a 1:1 row transform converting a `string-body` field between CSV <-> JSON and
  text <-> Markdown. Deterministic and local; no AI (owner ruling, AI deferred to HEL-1135).
- An unconvertible value fails the step with a named reason code; the step never emits empty or dropped rows.
- Full op wiring: step registry and `PipelineStepKind.All`, config codec, engine apply, analyze inference with a
  typed analyze response, repository decode.
- HEL-1092 cost verdict: `convertformat` gets its own deny reason `content-conversion`. `AiOps` is unchanged.
- Tests that used `convertformat` as an unregistered stand-in are updated to a different fake op.
- Doc corrections: design spec section 6 no longer groups `convertformat` with ClaudeClient steps; the `AiOps`
  comment names HEL-1106/1107.

## Capabilities

### New Capabilities

- `pipeline-convertformat-op`: config, supported pairs, lossless round-trip contract, named failure reasons, analyze
  inference.

### Modified Capabilities

- `pipeline-analyze-api`: the cost verdict denies `convertformat` with `content-conversion` instead of
  `unclassified-op`.

## Impact

Backend only: `domain/steps`, `domain/model/PipelineStep.scala`, `PipelineStepConfigCodec`, `PipelineAnalyzeService`,
`PipelineAnalyzeProtocol`, `PipelineService`, `PipelineStepRepository`, `PipelineCostEstimator`, tests, and the design
spec doc. No migration, no new dependency, no frontend editor.

## Non-goals

- A StepCard config editor (HEL-1109).
- AI-backed conversion or enhancement, or hooks for it (HEL-1135).
- `binary-ref` content (reading stored bytes from a step), and any pair beyond the two above.
- Changing the AI or write-back cost sets.
