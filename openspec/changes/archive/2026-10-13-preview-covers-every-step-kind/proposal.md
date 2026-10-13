## Why

A patch-set preview of a `pipelineStep` update fails for three of the 27 registered step kinds (`convertformat`, `analyzewithai`, `generatetext`): `PipelineStepProjectionSupport.withPosition` has no arm and no default for them (a `MatchError`, surfacing as a 500), and `withDecodedConfig` falls through to its defensive `Left`, so a config edit is wrongly rejected as a 400 "type mismatched" error. Apply handles all three, so preview and apply disagree. The match is over an unsealed trait, so nothing stopped the drift when those kinds were added.

## What Changes

- Add the missing `ConvertFormatStep` / `AnalyzeWithAiStep` / `GenerateTextStep` arms to both `withPosition` and `withDecodedConfig` in `PatchSetPreviewProjectionSteps.scala`.
- Replace the `withPosition` non-exhaustive match's silent MatchError failure mode with a structural, `PipelineStep.Registry`-driven guard spec that fails at test time when any registered kind lacks an arm in either function (and a mutation proving the guard can go red).
- Route-level red-first specs through `POST /api/patch-sets/preview` for each previously-missing kind: position-only update and config update both return 200 with a correct `after`; plus an apply-path check that `POST /api/patch-sets/apply` (or the existing apply route) updates the same steps.

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-preview`: adds a requirement that a `pipelineStep` update preview resolves for every registered step kind (no 500, no spurious 400) and agrees with apply.

## Impact

- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjectionSteps.scala` (arms; scaladoc counts corrected).
- New backend test specs under `backend/src/test/scala/com/helio/{api/routes/patchsets,services/patchsets}/`.
- No API shape change, no migration, no frontend change. Does not touch panel-row lock or trigger code (HEL-1534).
