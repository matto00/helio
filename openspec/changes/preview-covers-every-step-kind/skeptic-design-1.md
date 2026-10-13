## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD ea04f2aa24db7fcdcac9e832f730eec234232fb9. The change dir is untracked, and no production edits have been made.

### What I verified (with evidence)

- **Missing-kind set (design Context): confirmed.** `PipelineStep.Registry` (`domain/model/PipelineStep.scala`, around lines 255-282) registers 27 kinds. The last three are `ConvertFormatStep`, `AnalyzeWithAiStep` and `GenerateTextStep`. `withPosition` and `withDecodedConfig` in `services/patchsets/PatchSetPreviewProjectionSteps.scala` each have 24 arms, ending at `UpsertSourceStep`. None of the three kinds appears in either function. I also checked for other hand-enumerated matches that might miss a kind: for every main file that names `UpsertSourceStep`, I compared its count against `GenerateTextStep`. Only `PatchSetPreviewProjectionSteps.scala` (upsert=2, gentext=0) and the per-kind files `UpsertSourceStep.scala`, `UpsertSourceConfig.scala` and `UpsertTargetAnalysis.scala` lack it, and those three are not kind enumerations. So no fourth kind is missing and no second site needs fixing. Both "22 step kinds" scaladocs are stale, as D5 says.
- **Predicted failure modes: consistent with code.** In `PatchSetPreviewStepProjection.pipelineStepUpdateAfter`, a config update calls `withDecodedConfig` first. For these kinds it falls to `case _ => Left(...)`, which becomes `ServiceError.BadRequest`, so a 400 is expected for (b). A position-only update (`config = None`) goes straight to `withPosition`, which has no arm for these kinds, so a `MatchError` is expected for (a). The design correctly says the observed status gets recorded rather than assumed (for example, the preview service might recover the throwable into something other than a 500).
- **Reusable kind+config to domain-step constructor: none is reachable, and the design's hedge holds.** The only production constructor is `PipelineStepRepository.rowToDomain` (line 1307), which is `private`. `Companion.readFromWire` and `decodeConfig` return the config, not a step. So D3 needs its fallback: a test-local factory that fails loudly on an unknown kind. That is acceptable. A new kind without a factory entry still turns the guard red and names the kind.
- **Route test base: exists.** `api/routes/patchsets/PatchSetPreviewRoutesSpec.scala` and `PatchSetPreviewCumulativeSpec.scala` both exist. `PatchSetRoutes.scala` mounts `POST /api/patch-sets/apply` and `POST /api/patch-sets/preview`. The guard patterns cited also exist: `api/protocols/pipelines/PipelineStepSecondSourceGuardSpec.scala` and `domain/model/PipelineStepRegistryCatalogSpec.scala`.
- **AI step tier gating at create/update: none.** `services/pipelines/PipelineStepCreate.scala` and `PipelineStepWrites` contain no tier check. Tier and quota gating sits at run time in `ClaudeAiStepClient.complete`, according to the `GenerateTextStep.scala` scaladoc (lines 19-20). D4's conditional ("if any of the three kinds is tier-gated...") therefore does not apply. Create and update need no special tier and make no network call.
- **Apply path is kind-agnostic.** `PipelineStepRepository.updateInternal` (lines 487-518) encodes by `row.op` and maps back through `rowToDomain`, which has arms for all three kinds (lines 1335-1337). This supports the ticket's claim that apply handles them.
- **Precedent and recurrence.** `services/patchsets/PatchSetPreviewProjectionStepsUpsertSourceSpec.scala` (HEL-1100) fixed exactly this defect class for one kind with per-kind tests and no structural guard, and the class has now recurred. This confirms that D3's registry-driven guard is the right shape, not scope creep.
- **AC coverage.**
  - Route-level red-first spec per kind, plus apply confirmation: D4 and tasks 1.2/2.2.
  - Missing arms: task 2.1.
  - Structural guard: D3 and tasks 1.3/3.1, with mutation proof and the size/contains assertions against a vacuous pass.
  - Driver addition "enumerate every missing kind": task 1.1.
  - No migration: correct. The plan touches no panel-row lock or trigger code.
- **Placeholders and contradictions:** none blocking. No TODO or TBD. The spec delta matches the design.

### Verdict: CONFIRM

### Non-blocking notes

1. **Make position-change assertions agree with apply.** Preview's `withPosition` copies the raw requested position, but apply's `positionScopedUpdateAction` clamps it to `[0, siblingCount]` and renumbers the sibling group. For the D4 position-only case and the "preview agrees with apply" check, the pipeline should have at least two sibling steps and the test should request an in-range index. Otherwise the change is a no-op, or preview and apply disagree for a reason that predates this ticket and is out of scope.
2. **Name every missing kind in one red run.** On unfixed code the D3 guard should name all three missing kinds, not abort at the first `MatchError`. Either generate one test case per registry kind, or catch per kind and collect the failures. Task 1.3 already says "naming each missing kind".
3. **Register the new guard in the scaladoc list.** Add it to the list of registry-driven guard tests in the `PipelineStepKind.All` scaladoc (`domain/model/PipelineStep.scala`, around lines 362-370), so the next person adding a kind finds it.
4. **Drop the stale tier hedge.** D4's "if tier-gated" branch can be dropped or restated: there is no create/update tier gate today (verified above).
5. **Optional tidy.** Consider folding or deleting `PatchSetPreviewProjectionStepsUpsertSourceSpec`, since the registry guard subsumes it. Keeping it is harmless.
6. **Fill or remove the empty heading.** `tasks.md` has an empty "Standing Constraints" heading.
