## Why

The v1.4 Unstructured Data release (HEL-147) added content connectors (text/Markdown, PDF, image —
HEL-215/214/216) that produce `string-body` content fields, but pipelines have no op that turns one
large content field into multiple analyzable rows. HEL-219 is the first of three text ops
(HEL-220 extract headings, HEL-221 chunk by token count follow) and establishes the reusable
row-expanding "text op" wiring pattern the other two will mirror.

## What Changes

- New pipeline op `splittext`: splits a `string-body` field into one output row per segment, either
  on paragraph breaks (blank-line-delimited) or Markdown heading boundaries (configurable level).
  Each output row carries the segment text plus a sequence-index field; all other input row fields
  pass through unchanged.
- Registers `splittext` in the execution engine (`PipelineStep` ADT/Registry) and in schema
  inference (`PipelineAnalyzeService`), with matching output-schema shape between the two paths.
- Adds analyze-time validation: the configured field must exist in the input schema and must be a
  `string-body` field, else a `validationError` is surfaced (mirrors the `compute` op's pattern).
- Adds a `SplitTextConfig` step-card component to the frontend step picker; its field dropdown is
  restricted to `string-body`-typed fields from the step's `inputSchema`.
- Flyway migration `V50` extends the `pipeline_steps_op_check` CHECK constraint to include
  `'splittext'`.

## Capabilities

### New Capabilities

- `pipeline-split-text-op`: execution-engine behavior, schema-inference behavior, and frontend
  step-card behavior for the new `splittext` pipeline op.

### Modified Capabilities

- `pipeline-steps-persistence`: the `pipeline_steps.op` CHECK constraint gains `'splittext'` as an
  allowed value (Flyway `V50`), and the `type` discriminator enum gains the same value.

## Impact

- Backend: new `backend/src/main/scala/com/helio/domain/steps/SplitTextStep.scala`; edits to
  `PipelineStep.scala` (Registry), `PipelineStepConfigCodec.scala`, `PipelineStepProtocol.scala`,
  `PipelineStepRepository.scala` (rowToDomain), `PipelineAnalyzeService.scala`; new migration
  `V50__add_splittext_op.sql`.
- Frontend: new `SplitTextConfig.tsx`; edits to `stepNarrowing.ts` (OP_TYPES, default config,
  narrowing helper), `pipelineStep.ts` (types), `StepCard.tsx` (wiring), `useStepCardState.ts`.
- No breaking changes — additive op, existing ops/wire shapes unaffected.

## Non-goals

- HEL-220 (extract headings) and HEL-221 (chunk by token count) are separate tickets, not
  implemented here — this change only establishes the pattern they will follow.
- No changes to `DataFieldType`/`type-registry-content-fields` — this op only consumes the
  existing `string-body` type, it does not add new field types.
