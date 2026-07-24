## Files modified

Note: `git diff --name-only main...HEAD` pulls in unrelated files from concurrent
v1.6 lanes already merged into this branch's base (fillnull/dedupe/unpivot/window
archives) because the local `main` ref is stale relative to the branch point. The
list below is the accurate scope of this change, taken from `git status --short`.

### New files

- `backend/src/main/resources/db/migration/V70__add_stringops_op.sql` — extends
  `pipeline_steps_op_check` to accept `'stringops'` (drop/re-add pattern). V70
  re-confirmed free both before writing (task 1.1) and immediately before this
  commit (task 7.1) — no collision with concurrent v1.6 lanes.
- `backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala` —
  `StringOpsConfig` + tolerant `decode` + `StringOpsStep` (`evaluate`/`apply`) +
  `companion`. Implements the six operations (`trim`/`upper`/`lower`/`split`/
  `extractRegex`/`concat`) per design.md decisions 2-7 (append-vs-overwrite by
  name equality, per-operation null handling, execute-time misconfiguration
  errors).
- `frontend/src/features/pipelines/ui/StringOpsConfig.tsx` — operation dropdown +
  conditional per-operation field editor (mirrors `WindowConfig.tsx`'s
  conditional-reveal pattern); concat's `fields` multi-select reuses
  `FillNullConfig.tsx`'s checkbox-list markup.
- `frontend/src/features/pipelines/ui/StringOpsConfig.test.tsx` — co-located
  component test (operation dropdown options, per-operation field reveal,
  onChange payloads for each control, concat checklist toggle).

### Backend wiring (mirrors `DateBucketStep`/`FillNullStep`'s registration)

- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registered
  `StringOpsStep.companion` in `PipelineStep.Registry` + `PipelineStepKind.StringOps`.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exported
  `StringOpsStep`/`StringOpsConfig` from `com.helio.domain.steps` into
  `com.helio.domain` (exhaustive-match consumer #1 per the ticket's checklist).
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` —
  `StringOpsStepResponse` + `jsonFormat6` + config formatter + discriminated-union
  read/write arms + `PipelineStepResponse.fromDomain` arm.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` —
  `encodeConfig`/`extractConfig` arms for `StringOpsConfig`/`StringOpsStep`.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` —
  dispatch case + `inferStringOps` (append-or-replace family, `filterNot` + `:+`,
  parity with `inferDateBucket`/`inferWindow`).
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` —
  `StringOpsAnalyzeStepResponse` + union read/write arms.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` —
  `rowToDomain` exhaustive-match arm (exhaustive-match consumer #2).
- `backend/src/main/scala/com/helio/services/PipelineService.scala` —
  `toAnalyzeStepResponse` exhaustive-match arm + explicit imports
  (exhaustive-match consumer #3).

### Frontend wiring (mirrors `DateBucketConfig`'s wiring)

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `StringOpsConfig`
  wire type + `StringOpsStep`/`StringOpsAnalyzeStep` interfaces + 3 union-type
  additions (8 edit sites total — the ticket's literal "4" undercounted this;
  mirrored `DateBucketConfig`'s actual site count per the skeptic's design-gate
  correction).
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `OP_TYPES` entry
  (label + `faFont` icon), `defaultConfigFor` case, `stringOpsConfigOf` narrowing
  helper.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — renders `StringOpsConfig`
  when `step.opType.id === "stringops"`.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — `stringOpsConfig`
  state + `onStringOpsChange` handler (omits per-operation-unused params from the
  persisted config, mirroring `onWindowChange`'s `usesField`/`usesOffset`
  omission pattern).

### MCP

- `helio-mcp/src/tools/write.ts` — added `stringops` to `add_pipeline_step`'s
  `type` enumeration and documented its config shape (description-only change;
  `type` is free-text `z.string()`, no schema change needed).

### Tests

- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` —
  17 round-trip execution tests (one per operation + null-handling, out-of-bounds
  split index, no-capturing-group/no-match regex, concat null-field, unsupported
  operation, overwrite-vs-append, row-count-unchanged).
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` —
  4 analyze-schema tests (overwrite, append, collision-rename, malformed config).
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` —
  codec round-trip (split, concat), `decode({})` tolerance, `encodeConfig`
  round-trip case.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` —
  added `StringOpsStepResponse` to the discriminated-union round-trip subtypes list.
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — kind-parity
  (`PipelineStepKind.All`), sealed-trait exhaustiveness match, and per-subtype
  `kind` assertion updated to include `StringOps`.
- `frontend/src/features/pipelines/ui/StringOpsConfig.test.tsx` — see "New files"
  above.

## Root cause / probe notes (Iron Law — systematic-debugging)

No bug fixes were required during this change; one test-authoring correction:
`InProcessPipelineEngineSpec`'s null-assertion tests
(`result.head("segment") shouldBe null`) failed to compile with `Cannot prove
that Any <:< AnyRef` — Scala's `shouldBe null` matcher requires an `AnyRef`
target. Root cause: `Map[String, Any]`'s value type is `Any`, not `AnyRef`.
Probe: `grep -n 'shouldBe null' InProcessPipelineEngineSpec.scala` showed every
existing null-assertion in the file already uses `.asInstanceOf[AnyRef]` before
`shouldBe null` (e.g. line 263, 991-993) — the same fix was applied to the 4 new
occurrences, confirmed by a clean `sbt test` run afterward.
