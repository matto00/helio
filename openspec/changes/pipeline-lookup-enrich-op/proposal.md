## Why

Pipelines can join a second `DataSource` (`join`) or stack one (`union`), but there is no
ergonomic way to enrich rows with just a few named columns from a small reference table (e.g. map
a code to a label) without exposing full join semantics. This is the ninth and final leaf of the
HEL-336 Pipeline Op Expansion epic.

## What Changes

- New `lookup` pipeline op: single-key left-join against a second `DataSource` (the reference
  table), bringing in only the named `columns` — unmatched rows get `null` for those columns;
  existing left columns are preserved.
- Backend: `LookupStep.scala` (async `evaluate`, modeled on `UnionStep.scala`'s
  `ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource` resolution), `PipelineStepKind.Lookup`,
  wire protocol (`LookupStepResponse`), config codec, `PipelineAnalyzeService` dispatch
  (`inferLookup` — additive: appends the requested `columns` typed `string`, best-effort, since the
  reference schema isn't resolvable at analyze time), `PipelineAnalyzeProtocol` response type,
  Flyway migration extending `pipeline_steps_op_check`.
- Backend: `PipelineService.addStep`/`updateStep` gain a `findByIdOwned` pre-flight ACL check for
  `LookupConfig.referenceDataSourceId`, mirroring the checks HEL-278 (join) and HEL-384 (union)
  already shipped — a cross-user `referenceDataSourceId` returns `404 Not Found` at creation/update
  time (see design.md).
- Frontend: `LookupConfig` wire type, `stepNarrowing.ts` registration — added directly to
  `OP_TYPES` (ships both an ACL check and a full editor, so it does not mirror `join`'s exclusion),
  `LookupConfig.tsx` editor (reference-source picker, sourceKey select, lookupKey + columns
  free-text inputs) wired into `StepCard.tsx` / `useStepCardState.ts`.
- MCP: `add_pipeline_step` tool documents `lookup` + its config shape.

## Capabilities

### New Capabilities

- `pipeline-lookup-op`: the `lookup` pipeline step — config shape, single-key left-join
  match/no-match/multi-match semantics, execute-time resolution/error handling, additive analyze
  inference, persistence, frontend editor, and MCP tool support.

### Modified Capabilities

(none — additive only; no existing capability's requirements change)

## Impact

- Backend: `domain/steps/LookupStep.scala` (new), `domain/PipelineStep.scala`,
  `domain/package.scala`, `api/protocols/PipelineStepProtocol.scala`,
  `api/protocols/PipelineStepConfigCodec.scala`, `api/protocols/PipelineAnalyzeProtocol.scala`,
  `domain/PipelineAnalyzeService.scala`, `repository/PipelineStepRepository.scala`,
  `service/PipelineService.scala`, new Flyway migration (`VNN__add_lookup_op.sql`, VNN confirmed at
  scheduling time and re-confirmed at delivery time).
- Frontend: `types/pipelineStep.ts`, `state/stepNarrowing.ts`, new `ui/LookupConfig.tsx` +
  `LookupConfig.test.tsx`, `StepCard.tsx`, `useStepCardState.ts`.
- MCP: `helio-mcp/src/tools/write.ts`.
- No breaking changes; additive only. Existing pipelines/rows unaffected.

## Non-goals

- Multi-key lookups (single key only).
- DAG/branching — pipelines remain linear chains.
- Resolving the reference source's live schema at analyze time (documented best-effort `string`
  typing for brought-in columns instead).
- Restricting the RUNTIME (evaluate-time) privileged source lookup — stays `findByIdInternal`,
  matching `join`/`union`; only the creation/update-time pre-flight is ownership-scoped.
