## Why

The v1.4 Unstructured Data release (HEL-147) added content connectors that produce `string-body`
content fields, and HEL-219 established the reusable "text op" wiring pattern (`splittext`) for
turning one content field into many rows. HEL-220 is the second of three text ops: extracting
Markdown headings out of a content field so each heading becomes its own analyzable row.

## What Changes

- New pipeline op `extractheadings`: scans a `string-body` field for Markdown ATX heading lines
  (`^#{1,6}\s+...`) and emits one output row per heading found, with the heading text replacing the
  content field and the heading level (1-6) written to a new metadata field. All other input row
  fields pass through unchanged. Rows with a null/missing field, or no headings at all, are dropped
  (zero output rows) — same tolerance philosophy as `splittext`.
- Registers `extractheadings` in the execution engine (`PipelineStep` ADT/Registry) and in schema
  inference (`PipelineAnalyzeService`), with matching output-schema shape between the two paths,
  and in the separate `AnalyzeStepResponse` wire ADT used by `GET /api/pipelines/:id/analyze`
  (the site HEL-219 initially missed — see its design.md decision 8).
- Adds analyze-time validation: the configured field must exist in the input schema and must be a
  `string-body` field, else a `validationError` is surfaced (mirrors `splittext`/`compute`).
- Adds an `ExtractHeadingsConfig` step-card component to the frontend step picker; its field
  dropdown is restricted to `string-body`-typed fields from the step's `inputSchema`.
- Flyway migration `V51` extends the `pipeline_steps_op_check` CHECK constraint to include
  `'extractheadings'`.

## Capabilities

### New Capabilities

- `pipeline-extract-headings-op`: execution-engine behavior, schema-inference behavior, and
  frontend step-card behavior for the new `extractheadings` pipeline op.

### Modified Capabilities

- `pipeline-steps-persistence`: the `pipeline_steps.op` CHECK constraint gains `'extractheadings'`
  as an allowed value (Flyway `V51`), and the `type` discriminator enum gains the same value.

## Impact

- Backend: new `backend/src/main/scala/com/helio/domain/steps/ExtractHeadingsStep.scala`; edits to
  `PipelineStep.scala` (Registry), `package.scala` (aliases), `PipelineStepConfigCodec.scala`,
  `PipelineStepProtocol.scala`, `PipelineStepRepository.scala` (rowToDomain),
  `PipelineAnalyzeService.scala`, `PipelineProtocol.scala` (AnalyzeStepResponse ADT),
  `PipelineService.scala` (toAnalyzeStepResponse); new migration
  `V51__add_extractheadings_op.sql`.
- Frontend: new `ExtractHeadingsConfig.tsx`; edits to `stepNarrowing.ts` (OP_TYPES, default config,
  narrowing helper), `pipelineStep.ts` (types), `StepCard.tsx` (wiring), `useStepCardState.ts`.
- Tests: new `ExtractHeadingsStepSpec.scala`, plus additive entries in the existing hand-curated
  lists (`PipelineStepSpec`, `PipelineStepConfigCodecSpec`, `PipelineStepProtocolSpec`,
  `InProcessPipelineEngineSpec`, `PipelineAnalyzeServiceSpec`, `PipelineStepRoutesSpec`,
  `PipelineAnalyzeRoutesSpec`), plus a frontend test for `ExtractHeadingsConfig.tsx`.
- No breaking changes — additive op, existing ops/wire shapes unaffected.

## Non-goals

- HEL-221 (chunk by token count) is a separate ticket, not implemented here.
- No changes to `DataFieldType`/`type-registry-content-fields` — this op only consumes the
  existing `string-body` type.
- No heading hierarchy/nesting output (e.g. parent-heading breadcrumbs) — each heading is a flat
  row with just its own text and level.
