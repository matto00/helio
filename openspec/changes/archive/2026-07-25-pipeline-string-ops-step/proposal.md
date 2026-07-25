## Why

Common per-value string cleaning (trim, upper/lower, split-and-take, regex-extract, concat)
currently forces a `compute` expression or isn't possible at all. This op offers a small
string-operation DSL that writes a derived string column, distinct from the row-exploding
`splittext` op. This is the seventh leaf of the HEL-336 Pipeline Op Expansion epic (v1.6).

## What Changes

- New backend `stringops` op (`StringOpsStep.scala`) — per-value column transform with six
  operations: `trim`, `upper`, `lower`, `split`, `extractRegex`, `concat`. Row count unchanged.
- `analyze_pipeline` dispatch for `stringops` — output schema = input schema with `outputColumn`
  typed `string` (replace-in-place if it collides with an existing field, append if new).
- Flyway migration extending `pipeline_steps_op_check` to accept `'stringops'`.
- Frontend `StringOpsConfig.tsx` step-card editor (operation dropdown that reveals only the
  relevant params per operation), wired into `StepCard.tsx` / `useStepCardState.ts` /
  `stepNarrowing.ts` / `pipelineStep.ts`.
- MCP `add_pipeline_step` tool description updated to document `stringops` + its config shape.

## Capabilities

### New Capabilities

- `pipeline-string-ops-op`: per-value string-cleaning pipeline step — trim, case conversion,
  split-and-take, regex extraction, and field concatenation, writing a derived string column,
  exposed in the pipeline step-card editor and the MCP write tool.

### Modified Capabilities

(none — `stringops` is additive; no existing capability's requirements change. `splittext`,
the row-exploding op, is untouched.)

## Impact

- Backend: `domain/steps/StringOpsStep.scala` (new), `PipelineStep.scala`,
  `PipelineStepProtocol.scala`, `PipelineStepConfigCodec.scala`, `PipelineAnalyzeService.scala`,
  `PipelineAnalyzeProtocol.scala`, exhaustive-match consumers (`domain/package.scala`,
  `PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`), new Flyway
  migration (next free VNN — re-confirm via `ls backend/src/main/resources/db/migration/ | sort`).
- Frontend: `types/pipelineStep.ts`, `state/stepNarrowing.ts`, new `ui/StringOpsConfig.tsx` +
  co-located test, `StepCard.tsx`, `useStepCardState.ts`.
- MCP: `helio-mcp/src/tools/write.ts`.
- Tests: `InProcessPipelineEngineSpec.scala`, `PipelineStepSpec.scala`, analyze-schema test,
  codec round-trip test, `StringOpsConfig.test.tsx`.

## Non-goals

- Row-exploding text splitting — that remains `splittext`, untouched by this change.
- DAG/branching support — chains linearly like all existing ops.
- Locale-aware case conversion or Unicode-normalization options — `upper`/`lower` use the JVM
  default-locale `String` methods, matching `CastStep`'s plain-`String` conversions.
