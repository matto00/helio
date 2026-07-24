## Why

Users cannot drop duplicate rows in a pipeline today. Two common needs are unmet: "distinct rows"
(whole-row de-duplication) and "one row per key, keep first/last" (de-dup by a key subset). This is
the fifth leaf of the HEL-336 Pipeline Op Expansion epic and the simplest op class so far — a pure
row filter with no schema change, following the `limit`/`sort` template.

## What Changes

- Add a new `dedupe` pipeline step: `DedupeConfig(keys: Vector[String], keep: String)`. Empty `keys`
  means whole-row distinct; non-empty `keys` dedupes on that key tuple. `keep` is `first` (default)
  or `last`, by original input row order. Output preserves the relative order of kept rows (stable).
- Wire `dedupe` through the full backend op surface: `PipelineStep` registration/kind, wire protocol
  (`DedupeStepResponse`), config codec (encode/extract), analyze passthrough (output schema == input
  schema, identity — no data sampling needed), and analyze wire protocol.
- Flyway migration extending `pipeline_steps_op_check` to accept `'dedupe'`.
- Frontend: `DedupeConfig` wire type, `stepNarrowing.ts` registration (label/icon/default
  config/narrowing helper), new `DedupeConfig.tsx` editor (keys multi-select + keep first/last
  toggle) wired into `StepCard.tsx`.
- MCP `add_pipeline_step` tool: document `dedupe` + its config shape in the tool description (the
  `type` param is free-text, not an enum).

## Capabilities

### New Capabilities

- `pipeline-dedupe-op`: the `dedupe` pipeline step — whole-row or key-set de-duplication with
  first/last-occurrence semantics, stable output order, identity schema passthrough on analyze, and
  its StepCard config editor.

### Modified Capabilities

(none — `dedupe` is additive; no existing capability's requirements change)

## Impact

- Backend: `domain/steps/DedupeStep.scala` (new), `domain/PipelineStep.scala`, `domain/package.scala`,
  `api/protocols/PipelineStepProtocol.scala`, `api/protocols/PipelineStepConfigCodec.scala`,
  `domain/PipelineAnalyzeService.scala`, `api/protocols/PipelineAnalyzeProtocol.scala`,
  `infrastructure/PipelineStepRepository.scala`, `services/PipelineService.scala`, new Flyway
  migration (next free VNN — reconfirm at write time and again before push).
- Frontend: `features/pipelines/types/pipelineStep.ts`, `features/pipelines/state/stepNarrowing.ts`,
  new `features/pipelines/ui/DedupeConfig.tsx` + `.test.tsx`, `features/pipelines/ui/StepCard.tsx`,
  `useStepCardState.ts`.
- MCP: `helio-mcp/src/tools/write.ts`.
- No new external dependencies. No breaking changes — additive op, existing pipelines unaffected.
