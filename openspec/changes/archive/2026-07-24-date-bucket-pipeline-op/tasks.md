## 1. Backend — step module + registration

- [x] 1.1 Re-confirm the current max Flyway migration number in `backend/src/main/resources/db/migration/` (design.md assumed V64 off `V63__pipeline_run_trigger_source.sql`) — bump if a concurrent lane has landed a same- or higher-numbered file since design time.
- [x] 1.2 Create `backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala`: `DateBucketConfig(field, granularity, outputColumn: Option[String])` + `jsonFormat3` + tolerant `decode` (via `StepCodecUtil.asObject`) + `DateBucketStep` case class + `evaluate` (UTC `java.time` flooring per design.md Decision 2; ISO-week-Monday for `week`; epoch-seconds-vs-millis heuristic per Decision 1; `null` on unparseable value; failed `Future` with descriptive message on unsupported `granularity`) + `companion`.
- [x] 1.3 Register `DateBucketStep.Kind -> DateBucketStep.companion` in `PipelineStep.Registry` (`PipelineStep.scala`) and add `val DateBucket: String = DateBucketStep.Kind` to `PipelineStepKind`.
- [x] 1.4 `PipelineStepProtocol.scala`: add `DateBucketStepResponse` + its format (count fields directly, do not assume `jsonFormat6`) + union-read/write arms + `fromDomain` case.
- [x] 1.5 `PipelineStepConfigCodec.scala`: add `encodeConfig`/`extractConfig` arms for `datebucket`.
- [x] 1.6 `PipelineAnalyzeService.scala`: add `case "datebucket" => inferDateBucket(config, inputSchema)` dispatch arm + `inferDateBucket` (replace-in-place if resolved output name exists in `inputSchema`, else append typed `date`, per design.md Decision 4).
- [x] 1.7 `PipelineAnalyzeProtocol.scala`: add `DateBucketAnalyzeStepResponse` + union arms (mirror the `cast`/`compute` analyze-response pattern).
- [x] 1.8 Write `backend/src/main/resources/db/migration/V<N>__add_datebucket_op.sql` following the `V50`/`V51`/`V52` drop/re-add pattern, full current op list (see `V52__add_chunkbytokencount_op.sql`) plus `'datebucket'`.

  Also updated (not separately enumerated by the plan, but required for the codec/protocol/repository match sites to stay exhaustive — same set of files every prior op addition touches): `backend/src/main/scala/com/helio/domain/package.scala` (type/val re-export aliases), `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` (`rowToDomain` dispatch), and `backend/src/main/scala/com/helio/services/PipelineService.scala` (`toAnalyzeStepResponse` dispatch).

## 2. Frontend — types + state + editor

- [x] 2.1 `frontend/src/features/pipelines/types/pipelineStep.ts`: add all four required entries per the existing per-op pattern (see `CastConfig`/`CastStep`/`CastAnalyzeStep` as the template) — the `DateBucketConfig` interface, a `DateBucketStep extends BasePipelineStep` interface plus its entry in the `PipelineStep` and `PipelineStepConfig` union types, and a `DateBucketAnalyzeStep extends BaseAnalyzeStep` interface plus its entry in the `AnalyzeStepResult` union type.
- [x] 2.2 `frontend/src/features/pipelines/state/stepNarrowing.ts`: add `datebucket` to `OP_TYPES` (label + icon), a `defaultConfigFor` case, and a `dateBucketConfigOf` narrowing helper (mirror the `cast`/`compute` helpers).
- [x] 2.3 New `frontend/src/features/pipelines/ui/DateBucketConfig.tsx`: field-name select (sourced from analyze `inputSchema`, mirroring `CastFieldsConfig.tsx`'s field-source pattern), granularity select (`day`/`week`/`month`/`quarter`/`year`), optional output-column text input.
- [x] 2.4 Wire the new editor into `frontend/src/features/pipelines/ui/StepCard.tsx` and `frontend/src/features/pipelines/hooks/useStepCardState.ts` (mirror how `cast` is wired, since both need `inputSchema`).

## 3. MCP

- [x] 3.1 `helio-mcp/src/tools/write.ts`: add `datebucket` to `add_pipeline_step`'s documented op list + config shape (`field`, `granularity`, optional `outputColumn`). Note: the `type` input field is `z.string().min(1)` (free text), not a `z.enum` — there is no enum to extend; the change is to the tool's `description` text, which is the only place op names are documented for MCP clients.

## 4. Tests

- [x] 4.1 `InProcessPipelineEngineSpec.scala`: round-trip execution tests for each granularity (day/week/month/quarter/year), an unparseable-value-yields-null case, an `outputColumn` append case, and an unsupported-granularity execute-time-failure case.
- [x] 4.2 Analyze-schema test (wherever `inferCast`/`inferCompute` are tested) covering the overwrite-in-place and new-append inference cases from the spec.
- [x] 4.3 Codec round-trip test for `DateBucketConfig` (encode → decode identity, tolerant-decode-of-partial-JSON).
- [x] 4.4 Update `PipelineStepSpec.scala`'s kind-parity exhaustiveness test to include `datebucket` (13 → 14 kinds).
- [x] 4.5 Add `frontend/src/features/pipelines/ui/DateBucketConfig.test.tsx`, mirroring the sibling `*Config.test.tsx` files (e.g. `CastFieldsConfig.test.tsx`, `ChunkByTokenCountConfig.test.tsx`) — every existing per-op editor component has a co-located test (CONTRIBUTING.md binds this); covers field-select, granularity-select, and output-column-input interactions and the resulting config PATCH shape.

  Also updated (round-trip parity for existing exhaustive-enumeration specs, same set every prior op addition touches): `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` (discriminated-union round-trip subtypes list).
