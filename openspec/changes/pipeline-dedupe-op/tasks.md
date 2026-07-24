## 1. Backend — domain step

- [x] 1.1 Re-confirm the current max Flyway `V*` migration number (`ls backend/src/main/resources/db/migration/ | sort`) before writing anything.
- [x] 1.2 Create `backend/src/main/scala/com/helio/domain/steps/DedupeStep.scala`: `DedupeConfig(keys: Vector[String], keep: String)`, tolerant `DedupeConfig.decode` (default `keep = "first"`, default `keys = Vector.empty`), `DedupeStep.apply`/`evaluate` implementing the single-pass (keep=first) / lookahead-pass (keep=last) stable filter from design.md, and `companion` (mirror `LimitStep`/`SortStep` shape exactly).
- [x] 1.3 Register `DedupeStep` in `backend/src/main/scala/com/helio/domain/PipelineStep.scala` (`Registry` map entry + `PipelineStepKind.Dedupe` constant + `All` set).
- [x] 1.4 Add `DedupeStepResponse` + format (`jsonFormat6`) + union arm + `fromDomain` in `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala`.
- [x] 1.5 Add `encodeConfig`/`extractConfig` arms for `dedupe` in `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala`.
- [x] 1.6 Add `'dedupe'` to the schema-passthrough dispatch group (alongside `filter`/`limit`/`sort`) in `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala`.
- [x] 1.7 Add `DedupeAnalyzeStepResponse` + union arm in `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala`.
- [x] 1.8 Update exhaustive-match consumers for the new kind: `backend/src/main/scala/com/helio/domain/package.scala`, `PipelineStepRepository.rowToDomain` (`backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala`), `PipelineService.toAnalyzeStepResponse` (`backend/src/main/scala/com/helio/services/PipelineService.scala`) — grep `Unpivot`/`Limit` in each file to find the exact match arms to extend.

## 2. Backend — migration

- [x] 2.1 Add Flyway migration `V<next>__add_dedupe_op.sql` extending `pipeline_steps_op_check` to include `'dedupe'` (drop/re-add pattern per `V50__add_splittext_op.sql`). Written as `V68__add_dedupe_op.sql`.
- [x] 2.2 Immediately before the delivery push, re-run the migration-directory check (`ls backend/src/main/resources/db/migration/ | sort`) and, if a higher `V*` number has landed in the interim (concurrent v1.6 lane), rename the migration file to the next free number and update the CHECK-constraint migration accordingly. Re-confirmed: V68 is still the max at delivery time — no collision, no rename needed.

## 3. Frontend

- [x] 3.1 Add `DedupeConfig` wire type to `frontend/src/features/pipelines/types/pipelineStep.ts`.
- [x] 3.2 Register `dedupe` in `frontend/src/features/pipelines/state/stepNarrowing.ts`: `OP_TYPES` entry (label + icon), `defaultConfigFor` case (`{keys: [], keep: "first"}`), `dedupeConfigOf` narrowing helper.
- [x] 3.3 Create `frontend/src/features/pipelines/ui/DedupeConfig.tsx`: key-fields multi-select (reuse the existing column multi-select pattern from a sibling `*Config.tsx`) + first/last toggle, calling `onChange` with serialized config JSON per design.md.
- [x] 3.4 Wire `DedupeConfig` into `frontend/src/features/pipelines/ui/StepCard.tsx` and `useStepCardState.ts` (dedupe case in the config-editor switch).

## 4. MCP

- [x] 4.1 Add `dedupe` to `add_pipeline_step` in `helio-mcp/src/tools/write.ts`: document the op + `{keys, keep}` config shape in the tool description string (the `type` param is free-text `z.string()`, not an enum — no schema change needed there).

## 5. Tests

- [x] 5.1 Add round-trip execution tests to `InProcessPipelineEngineSpec.scala`: whole-row distinct, key-set dedupe with `keep=first`, key-set dedupe with `keep=last`, null-key collapsing, stable-order preservation.
- [x] 5.2 Add an analyze passthrough test confirming `outputSchema == inputSchema` and no `validationError` for a `dedupe` step.
- [x] 5.3 Add codec round-trip test(s) for `DedupeConfig` encode/decode (including tolerant-decode of missing/malformed fields).
- [x] 5.4 Update `PipelineStepSpec.scala` kind-parity test to include `dedupe`.
- [x] 5.5 Add `frontend/src/features/pipelines/ui/DedupeConfig.test.tsx` covering key selection, empty-keys (whole-row) case, and first/last toggle onChange behavior.
