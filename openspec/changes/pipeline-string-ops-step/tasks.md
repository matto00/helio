## 1. Backend: migration

- [x] 1.1 Re-confirm the current max Flyway migration number via `ls
      backend/src/main/resources/db/migration/ | sort` (do this immediately before writing the
      migration — do not trust the ticket/design's stated VNN, multiple v1.6 op lanes may contend).
- [x] 1.2 Add `backend/src/main/resources/db/migration/V<NN>__add_stringops_op.sql` extending
      `pipeline_steps_op_check` to include `'stringops'`, following the drop/re-add pattern from
      `V69__add_fillnull_op.sql`.

## 2. Backend: StringOpsStep

- [x] 2.1 Create `backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala` —
      `StringOpsConfig(operation: String, field: String, outputColumn: String, pattern:
      Option[String], separator: Option[String], index: Option[Int], fields:
      Option[Vector[String]])`, tolerant `decode` (mirrors `DateBucketConfig.decode`/
      `FillNullConfig.decode` via `StepCodecUtil`), `StringOpsStep` case class,
      `StringOpsStep.apply`/`evaluate`, and `companion` (mirrors `DateBucketStep`/`CastStep` shape).
- [x] 2.2 Implement `trim`/`upper`/`lower`: null/absent `field` value yields `null`; otherwise apply
      the JVM default-locale `String` transform.
- [x] 2.3 Implement `split`: literal (non-regex) `separator` split of `field`'s value, take `index`;
      out-of-bounds `index` yields `null` for that row; missing `separator`/`index` in config fails
      at execute time before any row is processed.
- [x] 2.4 Implement `extractRegex`: `pattern` MUST contain at least one capturing group — zero
      groups fails at execute time naming the pattern; per row, null/absent `field` or a non-match
      yields `null`; a match extracts the first capturing group.
- [x] 2.5 Implement `concat`: joins `fields` with `separator`; a null/missing field in `fields`
      contributes an empty string (not whole-output null) — see design.md Decision 4.
- [x] 2.6 Apply the append-vs-overwrite rule uniformly: `row + (outputColumn -> value)` (natural
      overwrite when `outputColumn == field`, natural append otherwise — no branching needed).
- [x] 2.7 Unsupported `operation` fails at execute time with a descriptive error naming the invalid
      value and the six supported operations.

## 3. Backend: wiring

- [x] 3.1 `PipelineStep.scala` — register `StringOpsStep.companion` + `PipelineStepKind.StringOps`.
- [x] 3.2 `PipelineStepProtocol.scala` — `StringOpsStepResponse` + format (`jsonFormat6`) + union
      arms + `fromDomain`.
- [x] 3.3 `PipelineStepConfigCodec.scala` — `encodeConfig`/`extractConfig` arms for `stringops`.
- [x] 3.4 `PipelineAnalyzeService.scala` — dispatch case for `stringops` + `inferStringOps`: output
      schema = input schema with `outputColumn` typed `string` (`filterNot` + `:+`, the same
      collision-safe shape `inferDateBucket`/`inferWindow` use).
- [x] 3.5 `PipelineAnalyzeProtocol.scala` — `StringOpsAnalyzeStepResponse` + union arms.
- [x] 3.6 Find and update the remaining exhaustive-match consumers by grepping an existing op kind
      (e.g. `"datebucket"` or `DateBucketStep`) across the backend: `domain/package.scala`,
      `PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`.

## 4. Frontend

- [x] 4.1 `types/pipelineStep.ts` — add `StringOpsConfig` wire type (grep an existing op, e.g.
      `DateBucketConfig`, for the 4 required additions per op).
- [x] 4.2 `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case
      (`{"operation": "trim", "field": "", "outputColumn": "", "pattern": null, "separator": null,
      "index": null, "fields": null}`), `stringOpsConfigOf` helper.
- [x] 4.3 New `ui/StringOpsConfig.tsx` — operation dropdown (`trim`/`upper`/`lower`/`split`/
      `extractRegex`/`concat`) that conditionally reveals `separator`+`index` (split),
      `pattern` (extractRegex), or `fields` multi-select+`separator` (concat); always shows `field`
      (except concat, which uses `fields`) and `outputColumn`; calls `onChange` with the typed
      config object (mirrors `WindowConfig.tsx`'s conditional-field-reveal pattern).
- [x] 4.4 Wire `StringOpsConfig` into `StepCard.tsx` + `useStepCardState.ts` (mirrors
      `DateBucketConfig`'s wiring).

## 5. MCP

- [x] 5.1 `helio-mcp/src/tools/write.ts` — add `stringops` to `add_pipeline_step`'s config-shape
      handling and document it (operation/field/outputColumn/pattern/separator/index/fields) in the
      tool description string (`type` is free-text `z.string()`, not an enum — description-only
      change, no schema change needed).

## 6. Tests

- [x] 6.1 `InProcessPipelineEngineSpec.scala` — round-trip execution test per operation (trim,
      upper, lower, split, extractRegex, concat), plus: out-of-bounds split index → null,
      no-capturing-group regex → execute-time failure, no-match regex → null, concat null-field →
      empty-string contribution, unsupported-operation → execute-time failure,
      `outputColumn == field` overwrite vs `outputColumn != field` append (row count unchanged in
      both cases).
- [x] 6.2 `PipelineAnalyzeServiceSpec.scala` (or equivalent) — analyze-schema test for `stringops`
      covering both the overwrite (`outputColumn == field`, no duplicate field) and append
      (`outputColumn` new, field added typed `string`) cases.
- [x] 6.3 `PipelineStepConfigCodecSpec.scala` — codec round-trip test for `stringops`.
- [x] 6.4 `PipelineStepProtocolSpec.scala` — wire protocol round-trip / kind-parity coverage for
      `stringops`.
- [x] 6.5 `PipelineStepSpec.scala` — update kind-parity test to include `StringOps`.
- [x] 6.6 `StringOpsConfig.test.tsx` — co-located test for the new editor component (operation
      dropdown, conditional field reveal per operation, onChange payloads).

## 7. Delivery prep

- [x] 7.1 Re-confirm the migration VNN is still the current max via `ls
      backend/src/main/resources/db/migration/ | sort` immediately before the delivery push
      (re-check again — do not reuse the check from task 1.1; other lanes may have landed since).
