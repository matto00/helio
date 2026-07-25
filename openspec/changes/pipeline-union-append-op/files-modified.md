## Backend — core step

- `backend/src/main/scala/com/helio/domain/steps/UnionStep.scala` — new: `UnionConfig(otherDataSourceId, mode)`, tolerant `decode`, async `evaluate` (resolves the other source via `ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource`, mirroring `JoinStep`), `byPosition`/`byName` stacking logic (design.md Decisions 2-4), `companion` (`Kind = "union"`).
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registered `UnionStep.Kind -> UnionStep.companion` in `PipelineStep.Registry`; added `PipelineStepKind.Union`; updated the async/repo-touching step doc comments to mention `UnionStep` alongside `JoinStep`.
- `backend/src/main/scala/com/helio/domain/package.scala` — added `UnionStep`/`UnionConfig` type+val aliases (mirrors every other step's re-export).
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — added the `UnionConfig` arm to `rowToDomain`'s exhaustive match.

## Backend — protocol, codec, analyze, ACL

- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — `UnionStepResponse` case class + `jsonFormat6` + write/read discriminated-union arms + `fromDomain` arm.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — `UnionConfig`/`UnionStep` imports, `encodeConfig` arm, `extractConfig` arm.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — added `"union"` to the passthrough dispatch case (`(inputSchema, None)`), with a doc comment explaining the best-effort-passthrough rationale (design.md Decision 6).
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — `UnionAnalyzeStepResponse` case class + `jsonFormat6` + write/read dispatch arms.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — `toAnalyzeStepResponse` union arm; **`unionCheckF` pre-flight ACL check** added to both `addStep` and `updateStep` (mirrors `joinCheckF` — `dataSourceRepo.findByIdOwned` on `UnionConfig.otherDataSourceId`, 404 on cross-user, design.md Decision 9).

## Backend — migration

- `backend/src/main/resources/db/migration/V71__add_union_op.sql` — new: extends `pipeline_steps_op_check` to accept `'union'` (drop/re-add pattern, full accumulated op list). Max migration number re-confirmed as V70 immediately before writing (V71 assigned) and re-confirmed again immediately before this handoff — no collision.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `UnionMode`, `UnionConfig`, `UnionStep`, `UnionAnalyzeStep` types added to the `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` discriminated unions.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `union` added directly to `OP_TYPES` (picker, per design.md Decision 7 — unlike `join`); corrected the stale HEL-278 comment on `OP_TYPES`/`join`'s exclusion to match design.md's corrected rationale; `defaultConfigFor("union")` case; `unionConfigOf` narrowing helper; `faObjectGroup` icon import.
- `frontend/src/features/pipelines/ui/UnionConfig.tsx` — new: other-data-source `Select` (sourced from the sources redux slice) + `byPosition`/`byName` mode toggle (filter-combinator button recipe), PATCHing on change; reuses existing `PipelineDetailPage.css` classes, no new CSS.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — imports `UnionConfig`, renders it for `step.opType.id === "union"`.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — `unionConfig` state + during-render sync + `onUnionChange` handler, wired into the hook's return object.

## MCP

- `helio-mcp/src/tools/write.ts` — `add_pipeline_step` tool description documents `union` in the op list and its config shape (`otherDataSourceId`, `mode: byPosition|byName`), including the analyze-passthrough caveat.

## Tests

- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — `makeStep`'s `UnionConfig` case; round-trip execution tests for `byPosition`, `byName` (with null backfill), `byName` with identical columns; missing/unresolvable `otherDataSourceId` error tests; unsupported-`mode` error test.
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — passthrough test asserting `outputSchema == inputSchema` and `validationError == None` for a `union` step.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — decode round-trip (`byPosition`/`byName`), `decode({})` tolerance test, and `union` added to the `encodeConfig` round-trip table.
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — `union` added to `PipelineStepKind.All`, `allSubtypes`, the kind-string assertion, and the exhaustive pattern-match test.
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` — `unionReq` helper; `UnionStepResponse` import; POST cross-user-404 / own-source-201 test pair (mirrors the join pair); new PATCH cross-user-404 test asserting the persisted config is unchanged (no join equivalent existed for this scenario).
- `frontend/src/features/pipelines/ui/UnionConfig.test.tsx` — new co-located test: picker population, other-source selection PATCH payload, mode-toggle PATCH payloads (both directions), `aria-pressed` state, and per-mode description text.
- `frontend/src/features/pipelines/state/stepNarrowing.test.ts` — new: `union`'s `OP_TYPES` inclusion, `defaultConfigFor("union")` seed, `unionConfigOf` narrowing (including the non-union-step and unrecognized-mode fallback cases).
