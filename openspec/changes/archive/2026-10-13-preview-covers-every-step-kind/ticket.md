# HEL-1535: Patch-set preview 500s (MatchError) on ConvertFormat / AnalyzeWithAi / GenerateText step updates

## Description

Follow-up from HEL-1498 (PR matto00/helio#984). The owner triaged it as standalone. The bug predates HEL-1498.

`PipelineStepProjectionSupport` in `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjectionSteps.scala` matches on 24 step kinds in `withPosition` (around lines 19-43) and `withDecodedConfig`. It has no arm and no default for `ConvertFormatStep`, `AnalyzeWithAiStep` or `GenerateTextStep`. `PipelineStepResponse.fromDomain` (`api/protocols/pipelines/PipelineStepProtocol.scala`) handles all three.

`PipelineStep` is an unsealed trait (`domain/model/PipelineStep.scala`), so the compiler gives no exhaustiveness warning. A patch-set preview of a `pipelineStep` update on one of these kinds would throw a `MatchError`, which surfaces as a 500. This was confirmed by reading the code during HEL-1498 planning; it has not been reproduced through the route yet.

## Acceptance criteria

* A red-first route-level spec: previewing a step update for each of the three kinds returns 200 with a correct `after` and does not 500. Also confirm the apply path handles them.
* Add the missing arms. Prefer a structural guard that fails loudly at compile or test time when a new step kind is added, for example a spec that enumerates every kind `fromDomain` handles and checks that `withPosition` and `withDecodedConfig` cover it.

## Driver additions (overnight brief, treated as claims to verify)

* Enumerate EVERY step kind the match misses, not only the three named, and prove each red-first through the real preview route.
* Stay out of the panel-row lock and trigger code (HEL-1534 in flight in another lane).
* No migration expected; V130 is the next free one if one were needed (re-check before claiming).

origin_kind: followup
origin_ticket: HEL-1498
