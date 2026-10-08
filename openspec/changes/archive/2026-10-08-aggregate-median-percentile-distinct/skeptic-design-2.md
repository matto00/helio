## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD e8381591fe52ffed36f846db990a274afc938add. The planning artifacts are untracked in the change dir. Spawn-cwd guard: READY.

### What I verified (with evidence)

**CR1 (write-path behaviour for invalid `p`): resolved.** Design Decision 2 now chooses option (a), write-time rejection. I checked each claim against the tree:
- Base `Companion.validateRawConfig = strictDecodeProblem(raw)` (`PipelineStep.scala:198`). `strictDecodeProblem` maps a `StepConfigTypeMismatch` to `Invalid '<kind>' config: ...` and any other decode failure to `None`. The `ComputeStep.scala:99-103` precedent is `super.validateRawConfig(raw).orElse{...}`. The design composes the same way. CONFIRMED.
- Call sites, each mapping `Some(msg)` to `ServiceError.UnprocessableEntity` (422):
  - `PipelineService.scala:1831-1836` (`addStepReporting`)
  - `:2185-2187` (update, config branch only, so enabled/position-only updates of a stored bad config are unaffected)
  - `PipelineProposalService.scala:295-297` (`validateStep`, reached from both `validate` and `apply` through `validateStructure`)
  - `PatchSetApplyResolvers.scala:204-207`

  CONFIRMED. No new status code.
- Analyze short-circuit: `PipelineAnalyzeService.scala:370-373`. `shapeRejection = companion.flatMap(_.validateRawConfig(config))`, and if it is non-empty the per-kind `validateAggregate` dispatch is never evaluated. A problem reported by the override therefore appears exactly once. `stepConfigProblem` wraps the same function. CONFIRMED.
- Transactional create: `buildStepsAction` (`PipelineService.scala:524/557`) and `validateStepCrossOwnerRefs` (:446) call only `PipelineStepConfigCodec.decode`, never `validateRawConfig`, for any kind. The design marks this explicitly out of scope, analyze/auto-run/apply still catch an invalid config there, and task 2.5 says "assert nothing new there". CONFIRMED and consistent.
- A non-numeric `p` goes to the decode-mismatch path. `StepCodecUtil.typedArray` (:135-145) throws `mismatch(key, elementShape, item)` when the element reader fails, so `super.validateRawConfig` reports it with the updated `{alias, fn, field, p?}` text (Decision 2, last bullet). CONFIRMED.
- Unsupported fns are now rejected at write time. This is a declared behaviour change. I checked for existing tests that would break:
  - `PipelineAnalyzeRoutesSpec.scala:404-421` seeds `bogus_fn` through `pipelineStepRepo.insertRootStep`, which bypasses the write path, and asserts `include("bogus_fn")` and `include("Unsupported aggregation function")`. It still holds if the override reuses that text.
  - I found no REST test that posts an unsupported aggregate fn and expects 201.
  - The frontend's add-row default is `fn: "sum"` (`AggregateConfig.tsx:111`), so editor drafts cannot trigger the new 422.
- Design, spec and tasks agree. Task 2.0 is the override. Task 2.1 asserts that one invalid aggregation gives one message. Task 2.5 covers create/update/proposal/patch-set acceptance and rejection plus `stepConfigProblem`, and excludes transactional create. The spec scenarios at lines 140-146 match. The round-1 contradiction (a test that could not pass) is gone.

**CR2 (MODIFIED blocks for stale fn lists): resolved.** I diffed the two MODIFIED requirements against the base `openspec/specs/pipeline-aggregate-op/spec.md` (:8-43 and :57-101). The only differences are the intended edits:
- the fn lists
- `p` in the description and config shape
- the empty-input row (`count_distinct` 0; `median`/`percentile` null)
- the null-skip scenario

Every base scenario is reproduced verbatim. The unmodified "selectable in the pipeline editor" requirement is correctly left out. `openspec validate aggregate-median-percentile-distinct --strict` prints "Change 'aggregate-median-percentile-distinct' is valid".

**Round-1 non-blocking notes:**
- Inf interpolation: `v[lo] == v[hi]` short-circuit added (Decision 4), with a test in task 1.4. Addressed.
- Decode error text: updated (Decision 2). Addressed.
- Cleared `p` in the editor: inline error, no emit, keeps the last valid `p`. Pinned in Decision 9, the spec scenario at :172-174 and task 4.2. Addressed.
- `requiredConfigProblems`: explicitly not used, to avoid double reporting (Decision 2). Addressed.

**Re-checked semantics:** the p90 value of 9.1, median 2.5, and median 20.0 for ["10",null,"abc",30] are still correct. `count_distinct` of ["a","b","a",null,"c"] is 3. Correct.

### Verdict: CONFIRM

### Non-blocking notes
- The proposal's "What Changes" bullet 3 still describes rejection as `validateStepConfig → validateAggregate` plus apply. It does not mention the write-time 422 or that unsupported fns now 422 on write. Design Decision 2 is authoritative and the tasks follow it, but refresh the proposal so the PR narrative names the behaviour change.
- `validateRawConfig` returns only the FIRST `aggregationProblem`. Today `validateAggregate` lists every bad aggregation joined with "; ". A step with two bad fns will now report one at a time. This is acceptable; if intended, say so in the test name.
- `aggregationProblem` must lowercase `fn` before every rule, including the "`p` only valid for percentile" rule and the "percentile requires `p`" rule. Otherwise `"PERCENTILE"` with `p` would be rejected, contradicting the spec's case-insensitivity. Add an upper-case case to the 2.3/2.5 tests.
- [-Inf, Inf] at p = 50 still yields NaN (`v[lo] != v[hi]`). This is the same class as `sum` over ±Inf. State what NaN serializes to, or exclude it, if you touch it.
- Keep the substring "Unsupported aggregation function" and the fn name in the write-time message so `PipelineAnalyzeRoutesSpec.scala:419-420` keeps passing.
