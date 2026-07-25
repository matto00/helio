## Why

Pipelines can only transform rows from a single upstream source. There is no way to stack rows
from a second, independently-resolved `DataSource` onto the current pipeline (e.g. combine two CSV
exports of the same shape). This is the eighth leaf of the HEL-336 Pipeline Op Expansion epic and,
like `join`, requires resolving a second source at execute time — the engine's only other
async/repo-touching op.

## What Changes

- New `union` pipeline op: stacks rows from a second `DataSource` (`otherDataSourceId`) onto the
  current row set, in one of two modes — `byPosition` (append rows assuming identical columns, no
  reconciliation) or `byName` (align on column names; a column present in one source but not the
  other is filled with `null` for the rows from the source lacking it).
- Backend: `UnionStep.scala` (async `evaluate`, modeled on `JoinStep.scala`'s
  `ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource` resolution), `PipelineStepKind.Union`,
  wire protocol (`UnionStepResponse`), config codec, `PipelineAnalyzeService` dispatch (best-effort
  passthrough — the second source's schema is not known at analyze time, so output schema = input
  schema unchanged; a dedicated case, not the unknown-op fallback, so no false `validationError`),
  `PipelineAnalyzeProtocol` response type, Flyway migration extending `pipeline_steps_op_check`.
- Backend: `PipelineService.addStep`/`updateStep` gain a `findByIdOwned` pre-flight ACL check for
  `UnionConfig.otherDataSourceId`, mirroring the check HEL-278 already shipped for
  `JoinConfig.rightDataSourceId` — a cross-user `otherDataSourceId` returns `404 Not Found` at
  creation/update time (see design.md Decision 9).
- Frontend: `UnionConfig` wire type, `stepNarrowing.ts` registration — added directly to `OP_TYPES`
  (the add-step picker), unlike `join` (which remains hidden for reasons unrelated to `union` — see
  design.md Context/Decision 7) — `UnionConfig.tsx` editor (other-source picker + mode toggle)
  wired into `StepCard.tsx` / `useStepCardState.ts`.
- MCP: `add_pipeline_step` tool documents `union` + its config shape.

## Capabilities

### New Capabilities

- `pipeline-union-op`: the `union` pipeline step — config shape, both stacking modes, execute-time
  resolution/error handling, analyze passthrough behavior, persistence, frontend editor, and MCP
  tool support.

### Modified Capabilities

(none — additive only; no existing capability's requirements change)

## Impact

- Backend: `domain/steps/UnionStep.scala` (new), `domain/PipelineStep.scala`,
  `domain/package.scala`, `api/protocols/PipelineStepProtocol.scala`,
  `api/protocols/PipelineStepConfigCodec.scala`, `api/protocols/PipelineAnalyzeProtocol.scala`,
  `domain/PipelineAnalyzeService.scala`, `repository/PipelineStepRepository.scala`,
  `service/PipelineService.scala`, new Flyway migration (`VNN__add_union_op.sql`, VNN confirmed at
  scheduling time and re-confirmed at delivery time).
- Frontend: `types/pipelineStep.ts`, `state/stepNarrowing.ts`, new `ui/UnionConfig.tsx` +
  `UnionConfig.test.tsx`, `StepCard.tsx`, `useStepCardState.ts`, `stepNarrowing` consumers
  (`stepNarrowing.ts` narrowing helpers used by step-rendering code).
- MCP: `helio-mcp/src/tools/write.ts`.
- No breaking changes; additive only. Existing pipelines/rows unaffected.

## Non-goals

- Source-type restrictions beyond what `PipelineRunService` already gates (static/csv today).
- DAG/branching — pipelines remain linear chains.
- Resolving the second source's live schema at analyze time (out of scope; documented passthrough
  limitation, matching `join`'s existing analyze gap).
- Restricting the RUNTIME (evaluate-time) privileged source lookup — HEL-278 deliberately kept
  `findByIdInternal` unscoped at evaluation time for `join`, and `union` follows the same model;
  only the creation/update-time pre-flight is ownership-scoped (that scoping IS in scope for this
  change — see "What Changes" and design.md Decision 9).
