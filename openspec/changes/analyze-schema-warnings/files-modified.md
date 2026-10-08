# Files modified — HEL-1235

- `backend/src/main/scala/com/helio/domain/engine/AnalyzeSchemaWarnings.scala` — NEW pure post-pass: completeness propagation (D3a), reference table (D3), join-key type families (D4), rename warnings (D5), deterministic ordering.
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — visibility only: `laneDependencyOf` private -> `private[engine]`. No logic change.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `analyze`, `analyzeConcise`, `analyzeProposal` call the pass on the post-overlay projections; `toWarningResponse`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` — `AnalyzeWarningResponse`, `warnings` on `PipelineAnalyzeResponse`, optional `warnings` on `ConciseAnalyzeNode`, formats.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProposalProtocol.scala` — `warnings` on `PipelineAnalyzeProposalResponse`.
- `backend/src/test/scala/com/helio/domain/engine/AnalyzeSchemaWarningsSpec.scala` — NEW: per-class red-first tests, completeness negatives (a)-(h), runtime join-equality probe.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeSchemaWarningsSpec.scala` — NEW: service-level persisted/concise/proposal tests + D6 non-blocking guards.
- `schemas/pipelines/pipeline-analyze-response.schema.json`, `pipeline-analyze-proposal-response.schema.json`, `pipeline-analyze-concise-response.schema.json` — `warnings` contract.
- `helio-mcp/src/types.ts` — `AnalyzeWarning`, fields on full/proposal/concise types.
- `helio-mcp/src/tools/read.ts`, `helio-mcp/src/tools/pipelineProposal.ts` — `analyze_pipeline` / `analyze_pipeline_proposal` descriptions.
- `helio-mcp/src/server.test.ts`, `helio-mcp/src/tools/pipelineProposalHandlers.test.ts`, `helio-mcp/src/context.test.ts` — description + passthrough tests; fixtures gain required `warnings`.
- `frontend/src/features/pipelines/types/pipelineStep.ts` — `AnalyzeWarning`, required `warnings` on `PipelineAnalyzeResponse`, `ConciseAnalyzeNode`.
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` — typed analyze fixture gains `warnings: []`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.createPlacement.test.tsx` — typed analyze fixture gains `warnings: []`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx` — typed analyze fixture gains `warnings: []`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx` — typed analyze fixture gains `warnings: []`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.reorderGuard.test.tsx` — typed analyze fixture gains `warnings: []`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.runHistory.test.tsx` — typed analyze fixture gains `warnings: []`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — typed analyze fixture gains `warnings: []`.

## Notes

- 1.1 D3 exclusion list confirmed (analyze already errors on unknown field): compute, convertformat, analyzewithai, generatetext, splittext, extractheadings, chunkbytokencount, pivot, unpivot, assert. Checked ops: filter, sort, dedupe, select, rename, cast, datebucket, window, fillnull, stringops, aggregate, groupby, lookup (sourceKey), join (joinKey; right key against a resolved secondary).
- 1.2 Only `pivot` has data-derived output column names (name-incomplete); no other op found.
- 1.3 Runtime join equality probe (in `AnalyzeSchemaWarningsSpec`, through the real `JoinStep.evaluate`): Int/Long/Double/BigDecimal keys match in every pairing; String never matches a number or boolean. Families: string+string-body -> string; integer+float -> numeric; boolean -> boolean; timestamp/binary-ref -> unknown (no warning). TYPE-TRUSTED final list: filter, sort, limit, dedupe, select, rename, stringops, assert, upsertsource; `cast` only when every target is one of string/integer/long/double/boolean/date (CastStep falls through to the raw string for `float`/`timestamp`/other targets); join/lookup only with a resolved type-complete secondary (lookup also requires every requested column present in the secondary, else the placeholder `string` type is untrusted). DROPPED vs the design's initial list: `compute` (falls back to the declared type), `fillnull` (constant strategy writes the raw string; mean/median write Double).
- 1.4 Pre-implementation reproduction: against the stub (no pass) all 30 positive cases in `AnalyzeSchemaWarningsSpec` failed (26 of 56 passed vacuously: negatives and probes).

## Mutation evidence (each applied temporarily, test run, then reverted)

Pass-level (`AnalyzeSchemaWarningsSpec`):
- pivot treated name-complete -> red: `(g) not warn for a data-derived column after a pivot`
- `aggregate` added to TYPE-TRUSTED -> red: `(h) be suppressed after an aggregate ...`
- no name-completeness reset after aggregate/groupby -> red: `(e) an aggregate under an incomplete input resets ...`
- validationError flag ignored -> red: `(d) not warn for a descendant of a step with a validationError`
- lookup always type-trusted -> red: `(f) be suppressed when a side is type-incomplete ...`
- `compute` added to TYPE-TRUSTED -> red: `be suppressed after a compute (its projected type is not proven ...)` (cycle 2 rewrite; `$a * 1` projects float against a string right key)

Guards (`PipelineAnalyzeSchemaWarningsSpec`):
- D6a: `canRun && warnings.isEmpty` in `PipelineService.analyze` -> red: `GUARD (D6a) ...`
- D6b: `stepConfigProblem` returning a problem for `join` -> red: `GUARD (D6b/d) ...`
- D6d: aggregate `validateRawConfig` rejecting the warned config -> red: setup `addStep` rejected, 5 tests failed incl. `GUARD (D6b/d)`. Note `stepConfigProblem`/`validateRawConfig` take no schema, so this guard is mostly an invariant; the mutation is synthetic.
- Surface wiring: persisted `analyze` warnings emptied -> red: `surface all three warning classes ...` and `GUARD (D6a)`.

## Task 6.3 dev-DB residue (executor probe, exact ids)

- users `3d04db9e-3456-479f-9f97-a4e22006ae1a` (hel1235-probe-1791490496@helio.test, empty), `48e9e9a9-81b4-498b-a6fd-191b83adac40` (hel1235-probe-1791490500@helio.test)
- data sources `bdc6193c-391b-47ea-a36c-e6ab3505ec26`, `43bd73c2-2310-4fc8-970d-d333c9914b17`
- pipeline `82624d18-85a7-4de3-aab9-33b9f139a870`; root `a77d1904-003f-43f1-bda1-2b0a0f8fe67e`
- steps `c6195988-17b6-49fe-9160-dcda7e1354e9`, `1d3bcfc0-ab5c-4959-8d6c-1f60b7ff8713`
- run `562bd077-db9a-4bf3-aef2-8b3933a0a69c`
