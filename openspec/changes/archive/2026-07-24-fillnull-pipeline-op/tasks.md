## 1. Backend: migration

- [x] 1.1 Re-confirm the current max Flyway migration number via `ls
      backend/src/main/resources/db/migration/ | sort` (do this immediately before writing the
      migration — do not trust the ticket/design's stated VNN, three v1.6 op lanes may contend).
- [x] 1.2 Add `backend/src/main/resources/db/migration/V<NN>__add_fillnull_op.sql` extending
      `pipeline_steps_op_check` to include `'fillnull'`, following the drop/re-add pattern from
      `V68__add_dedupe_op.sql`.

## 2. Backend: FillNullStep

- [x] 2.1 Create `backend/src/main/scala/com/helio/domain/steps/FillNullStep.scala` —
      `FillNullConfig(columns: Vector[String], strategy: String, value: Option[String])`, tolerant
      `decode` (mirrors `DedupeConfig.decode`/`WindowConfig.decode`), `FillNullStep` case class,
      `FillNullStep.apply`/`evaluate`, and `companion` (mirrors `CastStep`/`DedupeStep` shape).
- [x] 2.2 Implement `constant` strategy: fill null cells in `columns` with `value`; fail at execute
      time with a descriptive error if `value` is absent.
- [x] 2.3 Implement `forwardFill` strategy: per-column single left-to-right pass carrying the last
      non-null value in original row order; leading null runs stay null.
- [x] 2.4 Implement `mean`/`median` strategies: single pass per column over non-null values coerced
      via `PipelineRowJson.toDouble` (numeric-only, matches `AggregateStep.avg`); all-null column
      stays null.
- [x] 2.5 Implement `mode` strategy: single pass per column counting raw non-null values, tie-break
      by first-encountered order; all-null column stays null.
- [x] 2.6 Unsupported `strategy` fails at execute time with a descriptive error naming the invalid
      value and the five supported strategies.

## 3. Backend: wiring

- [x] 3.1 `PipelineStep.scala` — register `FillNullStep.companion` + `PipelineStepKind.FillNull`.
- [x] 3.2 `PipelineStepProtocol.scala` — `FillNullStepResponse` + format (`jsonFormat6`) + union
      arms + `fromDomain`.
- [x] 3.3 `PipelineStepConfigCodec.scala` — `encodeConfig`/`extractConfig` arms for `fillnull`.
- [x] 3.4 `PipelineAnalyzeService.scala` — dispatch case for `fillnull` joining the existing
      identity-passthrough group (cast/filter/limit/sort/dedupe): output schema == input schema.
- [x] 3.5 `PipelineAnalyzeProtocol.scala` — `FillNullAnalyzeStepResponse` + union arms.
- [x] 3.6 Find and update the remaining exhaustive-match consumers by grepping an existing op kind
      (e.g. `"dedupe"` or `DedupeStep`) across the backend: `domain/package.scala`,
      `PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`.

## 4. Frontend

- [x] 4.1 `types/pipelineStep.ts` — add `FillNullConfig` wire type (grep an existing op, e.g.
      `DedupeConfig`, for the 4 required additions per op).
- [x] 4.2 `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case
      (`{"columns": [], "strategy": "constant", "value": null}`), `fillNullConfigOf` helper.
- [x] 4.3 New `ui/FillNullConfig.tsx` — columns multi-select (from step's known input columns),
      strategy dropdown (`constant`/`forwardFill`/`mean`/`median`/`mode`), constant-value text
      input shown only when strategy is `constant`; calls `onChange` with serialized config JSON.
- [x] 4.4 Wire `FillNullConfig` into `StepCard.tsx` + `useStepCardState.ts` (mirrors
      `DedupeConfig`'s wiring).

## 5. MCP

- [x] 5.1 `helio-mcp/src/tools/write.ts` — add `fillnull` to `add_pipeline_step`'s config-shape
      handling and document it (columns/strategy/value) in the tool description string (`type` is
      free-text `z.string()`, not an enum — no schema change needed, description-only).

## 6. Tests

- [x] 6.1 `InProcessPipelineEngineSpec.scala` — round-trip execution test per strategy (constant,
      forwardFill, mean, median, mode), plus unsupported-strategy failure and missing-`value`
      failure for `constant`.
- [x] 6.2 `PipelineAnalyzeServiceSpec.scala` — analyze passthrough test for `fillnull` (output
      schema equals input schema).
- [x] 6.3 `PipelineStepConfigCodecSpec.scala` — codec round-trip test for `fillnull`.
- [x] 6.4 `PipelineStepProtocolSpec.scala` — wire protocol round-trip / kind-parity coverage for
      `fillnull`.
- [x] 6.5 `PipelineStepSpec.scala` — update kind-parity test to include `FillNull`.
- [x] 6.6 `FillNullConfig.test.tsx` — co-located test for the new editor component (column
      multi-select, strategy dropdown, conditional constant-value input, onChange payloads).

## 7. Delivery prep

- [x] 7.1 Re-confirm the migration VNN is still the current max via `ls
      backend/src/main/resources/db/migration/ | sort` immediately before the delivery push
      (re-check again — do not reuse the check from task 1.1; other lanes may have landed since).
