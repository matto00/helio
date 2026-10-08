## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed the tree at f9f38bb42f9e505751a3511a2fe9a3270382ec87 (the change dir is untracked and has no code changes yet).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/autorun-skip-misconfigured-pipelines/HEL-1279`.

### What I verified (with evidence)

1. **Current auto-run gate (premise).** `AutoRunTriggerService.evaluateAndSchedule` (services/pipelines/AutoRunTriggerService.scala:73-92) gates only on `PipelineCostEstimator.estimate(costInput).autoRunnable`. It never looks at step config. Allowed leads to `upsertDebounce`. Denied leads to `handleDenied(..., verdict)`, where canRun is true for the owner or an editor and false for a viewer (L120-124). This confirms the design's Context section.

2. **D2 / HEL-1280 safety (point 1).** `PipelineAnalyzeService.validateStepConfig(kind, config)` (domain/engine/PipelineAnalyzeService.scala:334) reads only the raw config string; no schema goes in. It combines three checks:
   - (a) `validateRawConfig`, a strict-decode type-mismatch check. On the canonical re-encoding of an already-decoded typed config, this cannot fire. Rename and Cast `requireStringMap` and ConvertFormat `pairError` were checked; convertformat is content-conversion-denied anyway.
   - (b) `companion.requiredConfigProblems(config)`. This is literally the predicate `InProcessPipelineEngine.evalOneStep` fails on (InProcessPipelineEngine.scala:269, 506-509). It is applied to `c.encodeConfig(step.configValue)`, the same encoding `PipelineStepConfigCodec.encode(step)` produces (PipelineStepConfigCodec.scala:40-44). Analyze already uses `PipelineStepConfigCodec.encode(s)` (PipelineService.scala:990, 1123).
   - (c) Per-kind enum validators. I spot-checked each one against the runtime check at the start of its step:
     - stringops: StringOpsStep:99
     - fillnull: strategy at FillNullStep:84; constant+value at :91, which is `Option.getOrElse` vs the validator's `isEmpty` and matches
     - window: function at WindowStep:99; FieldRequired+field at :105-107; offset at :111-117 (runtime `getOrElse(1) <= 0` matches the validator's `exists(_ <= 0)`)
     - groupby: GroupByStep:71-75 (both lowercase)
     - pivot: PivotStep:80
     - union: UnionStep:69
     - join: JoinStep:69-72 (both lowercase)
     - aggregate: AggregateStep:94/115 (both lowercase)

     All of them match. There is one edge exception; see note 1. It does not block.

   **Conclusion:** the class-1 config check rejects nothing the engine would run successfully on real input. The design's choice to *not* gate on `inferOutputSchema` errors (class 2) is right. Those errors include schema-dependent "Unknown field" results (PipelineAnalyzeService.scala:599, 665, 755, 789, 826, 885, 952), which are exactly HEL-1280's false-positive class.

3. **Reachability of the red test (point 2).** `ComputeStep.validateRawConfig` (ComputeStep.scala:99-103) accepts an empty/whitespace expression and does no column check. The `{}` seed is accepted on every kind except analyzewithai and generatetext (guard in PipelineStepRequiredConfigSpec.scala:510-516). `ComputeStep.requiredConfigProblems` (L115-119) flags an empty `column` or `expression`. So `compute {column:"", expression:""}` can be saved and will fail at run. The existing AutoRunTriggerServiceSpec seeds steps through `pipelineStepRepo.insertInternal` (L117), and PipelineServiceCanRunSpec:132 seeds a misconfigured aggregate the same way. The RED path can be reached either way.

4. **Single source (point 3).** The AC says to reuse analyze validation and not add a parallel check. Exposing the existing `validateStepConfig` and calling it from AutoRunTriggerService is reuse, not a re-implementation. HEL-1266's `toCostVerdictResponse` (PipelineService.scala:1059-1071) builds its config reasons from `analyzed` in `enabledSteps` order (PipelineService.scala ~1000: `enabledSteps.flatMap(s => projections.get(...))`). D3's "cost reasons first, then config reasons in enabledSteps order" matches that.

   The scoping decision (class 1 only) is an intentional subset of analyze's `validationError`. It is recorded in the design and the spec delta ("SHALL NOT deny auto-run" for schema-derived problems), and it is guarded by task 4.1 with a mutation check. I accept that as "reuse", not "parallel": the predicate is shared and only the scope is narrowed.

   D2's caveat about dangling parent/lane nodes is correct. `analyzeNodes` leaves unreachable nodes out of its result, while the per-step call still checks them. That can only deny something that cannot run anyway.

5. **canRun=false and the contract (point 4).**
   - `toCostVerdictResponse` sets `canRun = canRun && configReasons.isEmpty`, so D4 mirrors it exactly.
   - The `run-to-update-affordance` spec already says to show no action when canRun is false.
   - `denyReasonCopy.ts:30,56` already maps `step-config-invalid`, so no frontend behaviour changes.
   - `schemas/sources/denied-pipeline-response.schema.json`: the enum lacks `step-config-invalid` today (verified). The planned additive enum value and the canRun description update are correct.
   - `scripts/check-schema-drift.mjs` compares schema fields to case classes. An extra enum value on a String field does not change field shape, so I expect no drift.
   - The frontend has no test that reads this schema's enum. The only schema refs are in denyReasonCopy.ts comments.
   - Backend `RowWriteResponseDenyReasonCoverageSpec` holds a literal `AllReasonCodes` list. It will not fail, but it should probably gain the new code (note 2).

6. **Concurrency constraints (point 5).** Per the design's Impact section and Non-Goals, and tasks 4.3 and 6, this change does not edit `DatasetWriteAutoRunEndToEndSpec`, `PipelineRunGuardRepository` or `PipelineRunService`. The touched files are AutoRunTriggerService, PipelineAnalyzeService, PipelineService (constant only; PipelineService is not the HEL-1371 file), the schema, and an optional comment in denyReasonCopy.ts. The new tests go in AutoRunTriggerServiceSpec and DataSourceServiceDeniedPipelinesSpec. Neither is owned by HEL-1374.

7. **Placeholders and contradictions.** There are no TODO/TBD items. The proposal, design, tasks and spec delta agree with each other: skip/deny, class-1 only, cost reasons first, canRun false, and the schema enum. Every AC is covered:
   - decide skip vs submit: D1
   - single source: D2/D3
   - red then green: task 1.1, plus the 4.1 mutation check

### Verdict: CONFIRM

### Non-blocking notes

1. **D2/Risks slightly overstate "never rejects a value the engine accepts".** `AggregateStep.apply` checks the function name only inside the per-group loop (L115-122) or in the no-groupBy empty-rows branch (L92-98). So an `aggregate` with `groupBy` set and an unsupported `fn` "succeeds" with zero rows when its input is empty. The validator denies it. The practical impact is nil: the output is meaningless, analyze already reports canRun=false for it, and the next non-empty input fails. Still, the wording in design.md D2/Risks should say "on any non-empty input" rather than "by construction".
2. Consider adding `step-config-invalid` to `RowWriteResponseDenyReasonCoverageSpec.AllReasonCodes` (backend/src/test/scala/com/helio/api/protocols/sources/RowWriteResponseDenyReasonCoverageSpec.scala:27-31). Its own doc says a new write-response code should be listed there.
3. The `run-to-update-affordance` toast requirement (openspec/specs/run-to-update-affordance/spec.md:11-16) lists only the estimator's codes. The toast can now receive `step-config-invalid`. The existing mapping and the canRun=false scenario already cover the behaviour, so a delta is optional. A short MODIFIED delta, or one toast scenario, would keep that spec accurate.
4. Task 4.1: pick a CHEAP op whose `inferOutputSchema` returns a schema-derived "Unknown field" error. Candidates are compute referencing a missing field (PipelineAnalyzeService.scala:599), pivot (L885) or unpivot (L952). Also confirm the op is in `PipelineCostEstimator.CheapOps`, so the test proves the config gate's scope rather than a cost denial.
5. The constant currently lives at `PipelineService.scala:2453` as `private val StepConfigInvalidCode`. D3's move to the `PipelineAnalyzeService` companion is consistent with the design. Remember the doc reference in `PipelineAnalyzeProtocol.scala:237`.
