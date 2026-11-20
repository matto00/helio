## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD dfb65eebb2dac32afbd1eaeb7fd6e94b369d0369 (artifacts untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/assistant-propose-insight-output/HEL-1779`.
- D1 premise holds: `AssistantProposalToolSchemas.scala:290-293` hand-lists six kinds; `OutputKind.all` (`model.scala:618`) includes `Insight`, and `asString` exists (`:641`).
- D2 premise holds: `OutputConfigValidation.scala:39-41` `DocumentedKnownKeys` filters `Insight`; `KeysDoc` (`:52-65`) says "Every kind: compare, fieldMapping, historyPayloads", which is wrong for insight (`KnownKeys(Insight) = InsightConfig.Keys`). Every constant D2 names exists in `InsightConfig.scala` (`MaxSentencesRange`, `MaxCharsRange`, `MaxPromptChars`, `MaxReadOutputs`, `MaxReadWindows`, the defaults, `InsightRefresh.all`, `OwnKeys`).
- D4 premise holds for create: `PatchSetOutputResolvers.resolveOutputCreate` (`:95-132`) runs `OutputService.validateConfig` and the field-mapping check but no `InsightReadsCheck`; apply (`PatchSetApplyForward.scala:111`) calls `OutputService.create`, which runs `checkInsightReads` (`OutputService.scala:150,186-198`).
- D3 premise holds: `PipelineCreatePreflight.scala:228-229` rejects any non-empty `reads.outputs` on a new pipeline (`Map.empty`).
- The drift spec's exclusion block exists as described (`OutputKindDriftSpec.scala:120-135`, `withoutInsight` at `:28`).
- Render path, for D5: `PipelineProposalService.scala:617` calls `pipelineRunService.submit(pipelineId, isDry = false, user)` when a pipeline proposal is applied. A successful real run calls `insightTrigger.afterRunSucceeded` (`PipelineRunSucceededWrites.scala:343`). That reaches `InsightRenderService.renderForRun` (`:87-98`), which renders every `on_run` insight of the pipeline, and `on_run` is the default `refresh` (`InsightConfig.parseRefresh`). `PipelineRunService`'s `insightTrigger` defaults to `InsightRunTrigger.NoOp` (`PipelineRunService.scala:114-115`, "no-op in fixtures"). Outside the insight specs, no test fixture wires a real trigger: `grep InsightRenderService|insightTrigger` under `backend/src/test` hits only `InsightRenderServiceSpec`, `InsightRenderFixture` and `ExistenceNotLeakedRoutesSpec`.
- Patch-set output UPDATE resolver: `resolveOutputUpdate` (`PatchSetOutputResolvers.scala:35-62`) does no config validation of any kind at preview. Apply (`PatchSetApplyForward.scala:104`) calls `OutputService.update`, which does run `checkInsightReads` (`OutputService.scala:282`).

### Verdict: REFUTE

### Change Requests

1. **D5 is wrong for the pipeline-proposal path, and its fallback instruction is unsafe.** Applying a `propose_pipeline`/`propose_combined` proposal starts a real run (`PipelineProposalService.scala:617`). When that run succeeds, it renders every `on_run` insight in production (`PipelineRunSucceededWrites.scala:343` -> `InsightRenderService.renderForRun`). So in production, a pipeline-proposal insight with the default `refresh` WILL call the model right after apply. D5 says "if the probe shows a path DOES render, that is a defect to fix in this change". That invites the executor to suppress HEL-1743's run trigger for the apply's run, which is an unsanctioned behavior change. Revise design, spec and docs to state the intended rule. It is consistent with HEL-1747's MCP wording, "creating an insight does not render it; it renders on the next real run" (`archive/2026-11-18-insight-mcp-surface/design.md:56`). Creating the Output writes no render. A pipeline proposal's apply runs the pipeline, and that run is the insight's first `on_run` trigger.
   - `InsightNewPipelineReadsDoc` and the D6 prompt bullet must say this. Use `refresh: "manual"` to avoid the immediate render.
   - The spec's "Pipeline proposal with insight" scenario and task 4.3 must not assert zero renders for that path. Either assert the documented behavior, or assert zero rows only for `refresh: "manual"`.
   - The "no `output_insights` row" assertion stays on the patch-set path, which starts no run.
   - If the planner believes the apply run must NOT render, that is a product decision outside HEL-1747's precedent and should be raised, not self-approved.

2. **The D5 / task 4.3 no-render test is vacuous as specified.** `PipelineRunService.insightTrigger` defaults to `InsightRunTrigger.NoOp` in every fixture. So "a model transport that FAILS on any call" plus "zero `output_insights` rows" passes whether or not any path renders. Required:
   - The test wires a real `InsightRenderService` (for example via `InsightRenderFixture` with a fake model that fails the test on any call) as the `insightTrigger` of the `PipelineRunService` that apply and backfill use.
   - A recorded mutation goes red: make the patch-set apply or backfill call `renderForRun`, or set the patch-set Output to `on_run` and submit a real run. Record it in `drift-mutations.md` or the evidence, per C12 and "demand the red".

3. **D4 leaves the update resolver ambiguous; the tree already answers it.** `resolveOutputUpdate` has the gap. It has more than the gap: it does no config validation at preview at all. D3 also tells the assistant that the `reads.outputs` rule applies on update. Required:
   - State explicitly that `resolveOutputUpdate` runs `InsightReadsCheck.check(existing.kind, Some(outputId), patch.config, existingConfig, ...)` against `listByPipelineInternal(existing.node.pipelineId)`.
   - Say whether it also runs `OutputService.validateConfig` for the insight keys, or why not.
   - Add a red-first test (task 1.2 or a new 1.2b) and a spec scenario "Bad reads rejected at preview on output update". Without it, the spec requirement "SHALL be rejected at preview for any `reads.outputs` apply would reject" has no scenario on update.

### Non-blocking notes

- `InsightReadsCheck`'s contract is that `pipelineOutputs` is the pipeline "as the write will leave" it. A patch set that deletes Output X and creates an insight reading X previews clean against stored state but fails at apply. Either note this as an accepted residual in Risks or build the map net of same-set deletes.
- D2's "insight takes only fieldMapping (leave it empty)": confirm `OutputFieldMappingCheck.validate(Insight, ...)` actually rejects or ignores a non-empty mapping, so the doc matches behavior.
- D3's refinement clause ("the executor checks whether refinement can create Outputs") is fine as a verify-and-record step. Record the finding in the evidence either way.
