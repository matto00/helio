# Files modified — HEL-814

## Read path: strict extractors and the 23 decoders (D1, tasks 2.1–2.4)

- `backend/src/main/scala/com/helio/domain/steps/StepCodecUtil.scala` — new `StepConfigTypeMismatch` plus the strict extractor family (`str`/`strOpt`/`int`/`intOpt`/`stringArray`/`typedArray`/`objectOpt`/`stringMap`); `asObject` now raises for a non-object top-level config (task 2.4); `normalizeEnum` preserves an unknown enum value verbatim (5.1b); `missingRequired`/`unsupportedEnum` back the D3/D4 declarations. HEL-860's `requireStringMap` kept unchanged.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exports `StepConfigTypeMismatch` alongside the other step types.
- `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/AssertStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/CastStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/ChunkByTokenCountStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/ComputeStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/DedupeStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/ExtractHeadingsStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/FillNullStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/FilterStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/GroupByStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/JoinStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/LimitStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/LookupStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/PivotStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/RenameStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/SelectStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/SortStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/SplitTextStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/UnionStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/UnpivotStep.scala`
- `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala`
  (all 23 decoders) — all 23 decoders converted to the strict extractors; item-level `flatMap`/`collect` drops replaced so a mismatched element fails the whole config; `configValue` added to every step; per-kind `SupportedCombinators`/`SupportedKeep`/`SupportedModes`/`SupportedEncodings` and the `requiredConfigProblems` declarations added where `enumeration.md` marks a field required or an enum coercing.

## SPI

- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — `configValue` on the trait; `validateRawConfig` now defaults to `strictDecodeProblem` (so all 23 kinds reject wrong types, D2) instead of `None`; new `requiredConfigProblems` — the single per-kind declaration both run and analyze evaluate (D3, task 4.1).

## Write path wiring — the ticket's actual defect (D0/D2, tasks 3.2/3.3)

- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` — `validateRawConfig` wired into `validateEmbeddedStepReferences`, before the decode and referential checks; rejection is 422.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala` — same hook wired into `validateStep` (MCP apply); rejection is 422.

## Run and analyze completeness (D3/D4, tasks 4.2/4.3)

- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — the fold evaluates `requiredConfigProblems` before `step.evaluate`, thrown as an `IllegalArgumentException` so HEL-859's attribution names the step and reason.
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — `validateStepConfig` evaluates the same declaration, and evaluates the wrong-type rejection OUTSIDE the pre-existing catch-all so a D1 raise is reported rather than swallowed.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `toAnalyzeStepResponse` no longer 500s on a decode failure that already carries a `validationError`; this keeps the shipped "the proposal analyze surface reports a key the typed decoder would discard" guarantee true now that the decoder rejects such keys instead of reducing them.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala` — `extractConfig` is now `step.configValue`, removing a second copy of the step→config mapping the run path also needs.

## Tests

- `backend/src/test/scala/com/helio/domain/steps/PipelineStepRequiredConfigSpec.scala` — **new.** The run/analyze proofs and guards for D3/D4, each naming which surface it targets; plus the registry-drift guard binding `enumeration.md`'s 23 kinds.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewServiceSpec.scala` — the preview characterization test relabelled as a GUARD (6.2) with the wrong-type PROOF (7.2) sited beside it, plus two more kind-level proofs and the draft guard.
- `backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala` — `pivot`/`unpivot`/`window` flipped to PROOFs (6.1); `join` relabelled a GUARD (6.3); the displaced `varName` absence-default assertion re-sited as a guard (2.5).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineProposalServiceValidateSpec.scala` — proposal-apply rejection PROOF (7.2b) and its draft guard.
- `backend/src/test/scala/com/helio/domain/steps/AssertStepSpec.scala` — three PROOFs (2.6b, 2.4) plus an absence GUARD.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — HEL-860's read-tolerance test narrowed to wrong-type only (2.6, PROOF) with the absence half kept as a paired guard.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — stored analyze surface re-pointed at its new behavior (2.7).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` — proposal analyze surface re-pointed at its new behavior (2.7).
- `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodecSpec.scala` — dedupe enum guard updated to the preserve-verbatim behavior (5.1b).
- `backend/src/test/scala/com/helio/domain/steps/ChunkByTokenCountStepSpec.scala` — encoding enum guard updated to the preserve-verbatim behavior (5.1b).
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala` — its ad-hoc `PipelineStep` implements the new `configValue`.

## Change artifacts

- `openspec/changes/harden-step-config-decoders/enumeration.md` — **new.** The per-field table with the 1.2b spec citations.
- `openspec/changes/harden-step-config-decoders/tasks.md` — checked off.
