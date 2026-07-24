## 1. ### Backend: core step

- [x] 1.1 Confirm current max Flyway version (`ls backend/src/main/resources/db/migration/ | sort -V | tail -1`); create `V<N>__add_window_op.sql` extending `pipeline_steps_op_check` to add `'window'` (drop/re-add per `V50__add_splittext_op.sql`)
- [x] 1.2 Create `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala`: `WindowConfig` case class, tolerant `decode`, `WindowStep.evaluate`/`apply` implementing partition + stable-order + all six functions per design.md decisions 2-5, `companion`
- [x] 1.3 Register `WindowStep` in `PipelineStep.Registry` and add `PipelineStepKind.Window` in `backend/src/main/scala/com/helio/domain/PipelineStep.scala`
- [x] 1.4 Add `WindowStep`/`WindowConfig` type aliases in `backend/src/main/scala/com/helio/domain/package.scala` (grep the `Pivot` aliases for the pattern)
- [x] 1.5 Add `rowToDomain` match arm for `WindowConfig` in `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala`

## 2. ### Backend: protocol + codec + analyze

- [x] 2.1 Add `WindowStepResponse` + implicit config format (`jsonFormat6`) + wire union `write`/`read` arms + `fromDomain` arm in `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala`
- [x] 2.2 Add `encodeConfig`/`extractConfig` arms for `WindowConfig` in `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala`
- [x] 2.3 Add `window` dispatch case + `inferWindow` (per design.md decision 6: type per function, replace-on-collision) in `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala`
- [x] 2.4 Add `WindowAnalyzeStepResponse` + union arms in `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala`
- [x] 2.5 Add `toAnalyzeStepResponse` match arm for `WindowConfig` in `backend/src/main/scala/com/helio/services/PipelineService.scala`

## 3. ### Frontend

- [x] 3.1 Add `WindowConfig` wire type in `frontend/src/features/pipelines/types/pipelineStep.ts` (4 additions per op-wiring checklist: wire type, `OP_TYPES` entry, `defaultConfigFor` case, narrowing helper)
- [x] 3.2 Add `OP_TYPES` entry (label + icon), `defaultConfigFor` case, and `windowConfigOf` helper in `frontend/src/features/pipelines/state/stepNarrowing.ts`
- [x] 3.3 Create `frontend/src/features/pipelines/ui/WindowConfig.tsx` — partitionBy multi-select, orderBy keys, function dropdown, field, outputColumn, offset (follow `PivotConfig.tsx` structure/DESIGN.md tokens)
- [x] 3.4 Wire `WindowConfig.tsx` into `frontend/src/features/pipelines/ui/StepCard.tsx` and `frontend/src/features/pipelines/hooks/useStepCardState.ts`

## 4. ### MCP

- [x] 4.1 Add `window` to `add_pipeline_step`'s description string in `helio-mcp/src/tools/write.ts`, documenting the config shape (free-text `type`, not an enum)

## 5. ### Tests

- [x] 5.1 Add round-trip execution tests (one per function: row_number, rank, dense_rank, running_sum, lag, lead; plus unsupported-function and partition-edge-null cases) in `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala`
- [x] 5.2 Add analyze-schema inference tests in `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala`
- [x] 5.3 Add codec round-trip test in `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala`
- [x] 5.4 Add protocol round-trip test in `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala`
- [x] 5.5 Update kind-parity test in `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala`
- [x] 5.6 Create co-located `frontend/src/features/pipelines/ui/WindowConfig.test.tsx`
