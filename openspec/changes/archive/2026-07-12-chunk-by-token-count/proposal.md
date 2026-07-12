## Why

HEL-219 (`splittext`) and HEL-220 (`extractheadings`) established the reusable "text op" wiring
pattern for turning a `string-body` content field into many rows. HEL-221 is the third and final
text op: chunking a content field into roughly-N-token pieces so it fits an LLM context window —
the one op in this family where token accuracy (not just line/paragraph structure) matters.

## What Changes

- New pipeline op `chunkbytokencount`: splits a `string-body` field into one output row per chunk
  of real BPE tokens (via the new `jtokkit` 1.1.0 dependency), each row carrying the chunk text plus
  a chunk-index field and an exact token-count field. All other input row fields pass through
  unchanged. Rows with a null/missing field are dropped (zero output rows), same tolerance as
  `splittext`/`extractheadings`.
- Step config adds an `encoding` selector (`o200k_base` default / `cl100k_base`) alongside
  `targetTokenCount`, so the op stays model-family-flexible rather than hardcoding one tokenizer.
- Registers `chunkbytokencount` in the execution engine (`PipelineStep` ADT/Registry) and in schema
  inference (`PipelineAnalyzeService`), with matching output-schema shape between the two paths, and
  in the separate `AnalyzeStepResponse` wire ADT used by `GET /api/pipelines/:id/analyze`.
- Adds analyze-time validation: the configured field must exist in the input schema and must be a
  `string-body` field, else a `validationError` is surfaced (mirrors `splittext`/`extractheadings`).
- Adds a `ChunkByTokenCountConfig` step-card component to the frontend step picker: field dropdown
  restricted to `string-body` fields, a token-count number input, and the encoding dropdown.
- Flyway migration `V52` extends the `pipeline_steps_op_check` CHECK constraint to include
  `'chunkbytokencount'`.
- Proactively splits `PipelineProtocol.scala`'s `AnalyzeStepResponse` ADT (case classes + formats)
  into a new `PipelineAnalyzeProtocol.scala` file — the file is already over its 250-line soft
  budget and this change adds another subtype to it; the split is behavior-preserving (same
  package, `PipelineProtocol extends ... with PipelineAnalyzeProtocol`).

## Capabilities

### New Capabilities

- `pipeline-chunk-by-token-count-op`: execution-engine behavior (real BPE tokenization via
  `jtokkit`), schema-inference behavior, and frontend step-card behavior for the new
  `chunkbytokencount` pipeline op.

### Modified Capabilities

- `pipeline-steps-persistence`: the `pipeline_steps.op` CHECK constraint gains
  `'chunkbytokencount'` as an allowed value (Flyway `V52`), and the `type` discriminator enum gains
  the same value.

## Impact

- Backend: new `ChunkByTokenCountStep.scala`; new dependency `com.knuddels:jtokkit:1.1.0`; edits to
  `PipelineStep.scala`, `package.scala`, `PipelineStepConfigCodec.scala`, `PipelineStepProtocol.scala`,
  `PipelineStepRepository.scala`, `PipelineAnalyzeService.scala`, `PipelineService.scala`; new
  `PipelineAnalyzeProtocol.scala` (extracted from `PipelineProtocol.scala`); new migration
  `V52__add_chunkbytokencount_op.sql`.
- Frontend: new `ChunkByTokenCountConfig.tsx`; edits to `stepNarrowing.ts`, `pipelineStep.ts`,
  `StepCard.tsx`, `useStepCardState.ts`.
- No breaking changes — additive op; the `PipelineProtocol.scala` split preserves all existing
  wire shapes and mix-in points.

## Non-goals

- No changes to `DataFieldType`/`type-registry-content-fields` — this op only consumes the
  existing `string-body` type.
- No sentence/semantic-boundary-aware chunking — chunk boundaries are pure token-count cutoffs,
  not aligned to sentence or paragraph edges.
- No support for encodings beyond `o200k_base`/`cl100k_base` (e.g. legacy `p50k_base`) — the two
  offered cover the current GPT-3.5/4 and GPT-4o model families per the ticket's decision.
