# Red evidence (HEL-1535) -- observed on UNFIXED code (HEAD ea04f2aa2 + new specs only)

## 1.1 Missing-kind set
`PipelineStep.Registry` has 27 kinds; `withPosition` / `withDecodedConfig` have 24 arms each. The registry guard (below)
iterates all 27 and reports exactly three gaps: analyzewithai, convertformat, generatetext. No fourth kind.

## 1.2 Route spec `PatchSetPreviewStepKindRoutesSpec` (POST /patch-sets/preview, pipeline = [limit, <kind>, limit])
Observed (6 of 6 failed):

| kind | position-only update | config update |
|---|---|---|
| convertformat | 500 Internal Server Error (scala.MatchError in withPosition) | 400 Bad Request |
| analyzewithai | 500 (MatchError in withPosition) | 400 |
| generatetext | 500 (MatchError in withPosition) | 400 |

Stack: `PipelineStepProjectionSupport$.withPosition(PatchSetPreviewProjectionSteps.scala:19)` <-
`PatchSetPreviewStepProjection$.pipelineStepUpdateAfter(...:39)`. The 400s are `withDecodedConfig`'s defensive
`Left("config decode produced a type mismatched with step kind ...")`. Predictions in design.md confirmed.

## 1.3 Registry guard `PatchSetPreviewProjectionStepsRegistryGuardSpec` (one run, all gaps named)
```
registered step kinds missing a preview projection arm:
analyzewithai: withPosition threw MatchError
analyzewithai: withDecodedConfig returned Left(config decode produced a type mismatched with step kind 'analyzewithai')
convertformat: withPosition threw MatchError
convertformat: withDecodedConfig returned Left(...'convertformat')
generatetext: withPosition threw MatchError
generatetext: withDecodedConfig returned Left(...'generatetext')
```
(non-vacuity test, 27 kinds + the three named, passes.)

Note: the route spec seeds a trunk `limit` with two SIBLING children (`attachAsTail`), the kind step at position 1, and
requests position 0 (Standing Constraint C1). The reds above were re-observed with this final spec on unfixed code
(6/6 failed: 500 x3 position-only, 400 x3 config).

## Green after fix (2.2)
Route spec: 6/6 pass (preview `after` equals apply `resultingState`; persisted position/config checked).
Guard spec: 2/2 pass.

## 3.1 Mutation proof
Deleted the `GenerateTextStep` arm from `withPosition` only, ran the guard spec:
```
[info] - should have a withPosition and withDecodedConfig arm for EVERY registered step kind *** FAILED ***
[info]   registered step kinds missing a preview projection arm:
[info]   generatetext: withPosition threw MatchError
[info] Tests: succeeded 1, failed 1
```
Arm restored (verified by diff); guard green again.
