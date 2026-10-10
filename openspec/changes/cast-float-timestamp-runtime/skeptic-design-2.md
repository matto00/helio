## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 719710c15d457de02bcb681192275f2f011268dc. The change dir is untracked and there are no code changes yet. Every claim below was checked against the live tree in the worktree.

### What I verified (with evidence)

- **Round-1 CR1 (gating) is fixed.**
  - `PipelineStep.rawConfigProblem` (PipelineStep.scala:283-284) is called only from write sites: PipelineService.scala:562 (single-call create), :1858 (step create), :2212 (step update with config); PipelineProposalService.scala:295; PatchSetApplyResolvers.scala:204/576/737.
  - The other repository writes accept no new caller-supplied config: `insertInternalAction` (PipelineService:603) sits behind the :562 check; `updateInternal` with `config = None` is at :2200.
  - Analyze calls `companion.validateRawConfig` directly (StepConfigValidation.scala:49). So does `RunConfigGate.stepConfigReasons` (RunConfigGate.scala:20, via `PipelineAnalyzeService.stepConfigProblem`), whose only callers are AutoRunTriggerService and PipelineSchedulerService.
  - So D4's `writeConfigProblem` hook, chained inside `rawConfigProblem` only, really is write-only. Scheduled runs and auto-runs of stored legacy pipelines stay ungated. Task 1.7 now tests the scheduler gate and the auto-run gate.
- **D4a matches the code.** `inferCast` (ColumnSchemaInference.scala:31-35) runs inside `parseConfig`'s catch-all (StepSchemaInference.scala:66-79). Today an unrecognised target throws from `SchemaField`'s require and becomes "cast config error"; `string-body`/`binary-ref` pass `canonicalizeLegacy` (model.scala:449) verbatim. Projecting the input type for a target outside `SupportedTargets` agrees with D5's `case _ => v` at run time.
- **Round-1 CR2 (predicate) is fixed.**
  - `DateBucketStep.parseToUtcDate` (DateBucketStep.scala:158-169) is private. It trims, and accepts epoch seconds/millis via `str.toLong` and then `parseNonEpochDate` (:174-179, public, with the space-separated formatter).
  - `TimestampParsing.looksLikeTimestamp` covers ISO date-time, ISO local date-time, ISO local date and `MM/dd/yyyy`, with no trim.
  - With D3's union, every value datebucket buckets today survives a `date`/`timestamp` cast unchanged, so no cast→datebucket chain regresses. The CSV misattributions are gone from design.md, the proposal and the spec delta.
- **D6 matches the code.** `castRuntimeTargets` (AnalyzeSchemaWarnings.scala:69) and `family` (:75-80): `timestamp` maps to `None`, so it never warns. D6's described effect is consistent with `typesPreserved`/`castTrusted`.
- **D7 / task coverage.** The parity spec iterates `SupportedTargets`. Tasks 1.1 through 1.8 cover red-first (1.8), legacy passthrough, the scheduler and auto-run gates, the analyze projection, cast→datebucket, proposal/patch-set rejection, and a real in-process run.
- **Status code checked.** The write-time rejection status was traced on every write surface (see CR1).
- **Downstream-consequence assertion checked.** Task 1.6's assertion was checked against SortStep, AggregateStep and FilterStep (see CR2).

### Verdict: REFUTE

### Change Requests

1. **The rejection status contradicts the code path the design routes through, and a shipped spec.**
   - What the artifacts say: the proposal ("rejects (400)"), the spec delta ("SHALL be rejected with a 400", scenario "fails with 400") and task 1.5 ("returns 400") all promise 400.
   - What the code does: D4 puts the check inside `PipelineStep.rawConfigProblem`. Every caller of that maps a problem to `ServiceError.UnprocessableEntity`, i.e. **422**:
     - PipelineService.scala:1866 (step create)
     - PipelineService.scala:565 (single-call create; comment at :559-561: "understood-but-refused one is 422 on every write surface")
     - PatchSetApplyResolvers.scala:198-206 (explicitly "Deliberately NOT the BadRequest (400)")
   - What the shipped spec says: the binding `openspec/specs/pipeline-step-config-rejection/spec.md` Purpose requires 422 for exactly this category on every write surface.
   - Consequences as written: either task 1.5 goes red after the fix, or an implementer special-cases a 400 that breaks the shipped spec. Either way the spec delta becomes a spec-divergence at the final gate.
   - Required: pick the status explicitly in design.md, then make the proposal, the spec delta and task 1.5 agree with it.
     - Recommended: 422. It is consistent with HEL-1402 and pipeline-step-config-rejection. Record that the owner ruling's "(400)" is read as "client-error rejection at write", and say so in the PR body.
     - If the orchestrator treats the literal 400 as binding, that is a conflict with a shipped spec and must be raised as an escalation, not decided silently.
2. **Task 1.6's "downstream consequence" assertion cannot be red on the pre-fix tree, which violates C2.**
   - `SortStep` compares any value that converts via `PipelineRowJson.toDouble` numerically, including numeric-looking Strings (SortStep.scala:39-40, 102-114; `PipelineRowJson.toDouble` maps `case s: String => s.toDoubleOption`).
   - `AggregateStep` (:149) and `GroupByStep` (:82) use the same coercion.
   - So "10.5 after 9.5" and an aggregate over `amount` already pass with string amounts. They would be evidence-shaped non-evidence for "downstream ops operate on strings".
   - Replace them with a downstream assertion that actually differs between String and Double. For example, `filter amount = 1.5` over a CSV cell `"1.50"`: FilterStep's `=` coerces numerically only when the runtime value is numeric (FilterStep.scala:110-121, `numericFieldValue` :144-152, HEL-889), so it matches after the fix and not before. A join on a numeric key would also work.
   - Record that assertion's pre-fix failure in the 1.8 red evidence. Keep the snapshot-row `Double` assertion as well.

### Non-blocking notes

- `AnalyzeSchemaWarningsSpec.scala:332-336` ("not trust a cast to float (CastStep falls through to the raw string)") asserts the old behaviour and will fail after D6. Task 2.3/2.4 should name it as an intended inversion, so it is not mistaken for, or "fixed" as, a regression.
- D3 accepts any integer string as an epoch timestamp (`"42"` kept under `timestamp`), and keeps a non-String input (e.g. a `Long` epoch) as `v.toString`. Both follow from the datebucket parity and the D7 String assertion. One explicit test line for a non-String input would remove the ambiguity about whether to emit `v` or `str` (D7 implies `str`).
- The kept untrimmed `" 2026-03-14 "` is buckettable by datebucket but would fail `looksLikeTimestamp`. This is owner ruling 3, and acceptable.
- I did not independently verify the dev DB exposure counts (read-only; not load-bearing for this gate).
