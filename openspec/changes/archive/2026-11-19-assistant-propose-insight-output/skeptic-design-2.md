## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD dfb65eebb2dac32afbd1eaeb7fd6e94b369d0369. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/assistant-propose-insight-output/HEL-1779`.

- **Round-1 CR1 (pipeline-proposal render) is resolved.** D5 and the spec now state the rule this way:
  - Creating an insight writes no render.
  - A pipeline-proposal apply runs the pipeline, and that run is an `on_run` insight's first trigger. This is documented to the model in `InsightNewPipelineReadsDoc` and the D6 prompt bullet, with `refresh: "manual"` as the way to avoid it.
  - The "fix it in this change" instruction is gone. Scenario 4.2 asserts zero rows only for a `refresh: "manual"` insight.
  - The planner reported the judgment call to the driver instead of self-approving a product change.
  - I confirmed the trigger path again: `PipelineProposalService.scala:617` calls `pipelineRunService.submit(pipelineId, isDry = false, user)`, and `PipelineRunSucceededWrites.scala:342-345` calls `insightTrigger.afterRunSucceeded` on a published `succeeded`.

- **Round-1 CR2 (vacuous no-render test) is resolved.** D5 and task 4.3 now:
  - require a real `InsightRenderService` as `insightTrigger`, over a fake model that fails on any call;
  - forbid `InsightRunTrigger.NoOp`;
  - require `eventually` with no sleep;
  - require a recorded mutation that goes red.

  The premise behind the patch-set "no render" claim also holds. Backfill goes through `PipelineRunBackfill.backfillOutputNode` (`PipelineRunBackfill.scala:61-80`), and the only `afterRunSucceeded` call site in main code is `PipelineRunSucceededWrites.scala:343` (grep of `insightTrigger|afterRunSucceeded`). A backfill that does not reach the succeeded-writes path cannot render, so the claim is true and the test is meaningful.

- **Round-1 CR3 (update resolver) is resolved.** D4 now runs `InsightReadsCheck.check(existing.kind, Some(outputId), ...)` and `OutputService.validateConfig` in `resolveOutputUpdate`. Task 1.2b and the spec scenario "Bad reads rejected at preview on output update" were added. Parity is real:
  - `OutputService.update` (`OutputService.scala:224-269`) runs `validateConfig(output.kind, patch, existingConfig, policy)` and then `checkUpdateReads`.
  - The patch-set forward apply calls `update` with the default `ValidateWrite` policy (`PatchSetApplyForward.scala:104`).
  - So anything preview now rejects already failed at apply.

- **The same-set delete note from round 1 was adopted**, as D4 "map net of same-set deletes" plus a spec scenario.

- **Signature check.** `InsightReadsCheck.check(kind, insightId, written, stored, pipelineOutputs, isSelectableModel)` (`InsightReadsCheck.scala:13-20`) matches D4's calls. A `$ref:` id fails the `pipelineOutputs.get(id)` lookup with the existing message, as D4 says.

- **D1.** The literal enum is at `AssistantProposalToolSchemas.scala:292`. It is the only hand-written kind list in main code (grep `"timeline"` hits only `model.scala` and this line). The JSON contract already lists `insight` in `schemas/pipelines/create-pipeline-transactional-output-request.schema.json:14`, which `pipeline-proposal.schema.json` `$ref`s. So "no API contract change" is correct.

- **D2.** All the constants it interpolates exist in `InsightConfig.scala:30-45`:
  - `InsightRefresh.all`
  - `Keys` / `OwnKeys`
  - `DefaultMaxSentences` / `DefaultMaxChars`
  - `MaxSentencesRange` / `MaxCharsRange`
  - `MaxPromptChars`, `MaxReadOutputs`, `MaxReadWindows`
  - `parseReadWindows` at `:127`

  `KeysDoc` has exactly three consumers: the two tool-schema sites and `RefinementEditShape.scala:268`.

- **D3.** `PipelineCreatePreflight.validateOutputConfig` (`:223-230`) runs `InsightReadsCheck` with `Map.empty`, so a non-empty `reads.outputs` is a 400 on a new pipeline, as the doc constant will say.

- **AC coverage.** Each AC is covered by a task:
  - red-first validate+apply: 1.1, 1.2, 1.2b, 4.1, 4.2
  - single source plus positive drift: D1, D2, D7, 1.3, 4.4
  - no render on create: D5, 4.3
  - no live model: C14 and the failing fake model

  I found no scope drift, no `TODO`/`TBD`, and no contradiction between proposal, design, tasks and spec.

### Verdict: CONFIRM

### Non-blocking notes

1. **Specs that deleting `DocumentedKnownKeys` (D2) will break.** Deleting it breaks compilation or assertions in existing specs that tasks.md does not list:
   - `OutputConfigValidationSpec.scala:179,181`. Line 181 asserts `KeysDoc should not include "insight"` and must be inverted, not deleted.
   - `RefinementEditShapeSpec.scala:388`
   - `AssistantProposalToolSchemasSpec.scala:273`
   - `DurationFormatSeamSpec.scala:70`, which asserts `KeysDoc.endsWith(<OutputFormatVocabulary sentence>)`. The new insight sentence must therefore go before `OutputFormatVocabulary.Doc`, not after it.

   Task 4.5 ("full affected spec files") catches all of this. Listing them up front saves a cycle.
2. **Where the D4 same-set-delete check can live.** `resolveOutputCreate` and `resolveOutputUpdate` are per-edit (`PatchSetOutputResolvers.scala:35-132`) and cannot see sibling deletes. The "net of same-set deletes" check needs a set-level pass over `resolved`, like the existing `rejectEditedOutputNodes` (`:152`). The per-edit resolver can still run the stored-state check. Either layout is fine, as long as the delete+reads scenario goes red first.
3. **D7's "every `OwnKeys` key appears in KeysDoc" is weak.** Several of those words (`reads`, `model`, `prompt`, `refresh`) can match unrelated prose; the existing drift spec already notes this for `reads`. Make the check scan only the `insight:` segment of KeysDoc, so the "re-add the `DocumentedKnownKeys` filter" mutation fails on more than the `insight:` anchor alone.
4. **Task 4.2's manual-insight zero-rows check passes by construction.** `renderForRun` skips non-`on_run` insights, so zero rows would appear even with a NoOp trigger. Record it as a GUARD and pair it with a mutation: flip the fixture to `on_run` and show a model call or row appears. That proves the wiring observes renders on this path too, the same way 4.3 does.
5. **Edge case to record, not necessarily handle.** Two updates of the same Output in one patch set mean preview judges the second against stored config, while apply judges it against the first update's result. This predates this change, so record it rather than fix it.
