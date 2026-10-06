## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `9f92504af38913ebe23fedec117e6f39c39dcaa5` (branch base, planning artifacts untracked).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/latency-spec-contention-flake/HEL-1344`.

### What I verified (with evidence)

- **The failing assertion is a millisecond p50 comparison, not a count or ordering.**
  `backend/src/test/scala/com/helio/services/sources/DatasetWriteSubmitLatencySpec.scala:166,194,230`:
  `percentile(afterSamples, 0.50) should be >= percentile(beforeSamples, 0.50) - 5L`, where the samples are
  `(System.nanoTime() - t0) / 1000000L`. "25 was not >= 31" means after-p50 = 25ms and before-p50 = 36ms. The
  "before" phase runs first in all three tests (lines 148/176/206 come before 158/186/220). CONFIRMED.

- **HEL-1096 set no owner-enforced latency bound.** In `openspec/changes/archive/2026-09-24-run-to-update-affordance/design.md:88-92`,
  D2 is "a measurement task, not an optimization one; p95 growth >200ms is a PR-body finding, not a silent ship".
  Its Risks section (line 137) says "D2 measures, doesn't yet bound". tasks.md C12/3.4 is "measure ... and report
  both numbers in the PR description". The >200ms clause is a reporting trigger, not a gate, and the current spec
  never enforced it anyway: its only assertion is a *lower* bound on after-p50, the opposite direction from a
  latency ceiling. The spec's own scaladoc (lines 34-36) says "Not a pass/fail correctness gate". Moving the timing
  behind an opt-in therefore drops no enforced owner requirement, and no escalation is needed. The artifacts'
  wording "HEL-1096 set no latency bound" is slightly imprecise, because it omits the 200ms report trigger (see
  notes).

- **D2's deterministic replacement holds on the fixture (static trace).**
  - All three methods fold `triggerAutoRunAwaited(id, user)` into the response:
    `DataSourceService.scala:861` (appendFormRow → `RowWriteResult.deniedPipelines`), `:883` (replaceRows), and
    `:911` (patchRow → `RowMutationResult.deniedPipelines`).
  - The before path is `serviceBefore` with `autoRunTriggerService = null` (spec:78), so
    `triggerAutoRunAwaited` returns `Future.successful(Vector.empty)` (`DataSourceService.scala:95-103`). That gives 0.
  - On the after path, `AutoRunTriggerService.triggerAutoRun` evaluates every pipeline rooted on the dataset (`:61-64`)
    on every call. Nothing short-circuits on an existing debounce row, because the debounce is just an upsert
    (`:87-89`).
  - In `PipelineCostEstimator.estimate`, the 3 step-less pipelines get no step reasons. Their root kind is
    `dataset` ∈ `KnownLocalKinds` (`:56`). Their row estimate is a known dataset count (`PipelineCostInputGathering`
    → `countDatasetRows`), well under `MaxAutoRunRows = 10000`, and `lastRunRowCount` is None because there are no
    runs. They are allowed and excluded from `deniedPipelines`.
  - The 2 `analyzewithai` pipelines get `ai-step` (`AiOps`, `:24,112`) and are denied.
  - `handleDenied` returns `Some(Denied(..., canRun = true))` when `pipeline.ownerId == user.id` (`:119-120`). The
    fixture inserts those pipelines with `owner_id = owner` (spec:111), so both are returned.
  - Result: exactly 2 on every after write and 0 on every before write. Each test uses a fresh user and dataset, and
    `listPipelineIdsForDataSourceInternal` is keyed by `dsId`, so tests cannot cross-contaminate.

- **D2 can fail under the stated mutation.** If `triggerAutoRunAwaited` → `Future.successful(Vector.empty)`, every
  after response carries 0, so `== 2` goes red on all three tests. A revert to fire-and-forget also yields an empty
  vector (red). An evaluation failure degrades to `Vector.empty` through `.recover` (`:99-102`), which is also red.
  The design's claims in D2 and D4 are accurate. Execution must still show the actual red run (tasks 2.1).

- **The probe plan (D1) is a real probe, not decoration.**
  - P1 reproduces the flake on the unmodified spec under capped contention and records k/N with sample arrays.
  - P2 is an order-swapped variant that tests a stated hypothesis with a stated prediction, plus per-sample arrays
    to locate the outliers.
  - There is an explicit stop-and-report branch if H1 is refuted, and a disclosed fallback method if P1 cannot
    reproduce, with no escalation of contention past the cap.
  - It sits within `DEBUG_ATTEMPTS: 2` (workflow-state.md).
  - One weakness is noted below as non-blocking.

- **The threshold is never loosened.** C1 forbids loosening or re-tuning. D2 explicitly rejects a looser threshold and
  rejects more iterations or warm-up with the same comparison. No wall-clock comparison survives in any pass/fail
  decision, and D3's measurement mode "asserts nothing about timing". CONFIRMED.

- **AC coverage.**
  - AC1 (probe and reproduce under contention): tasks 1.1 and 1.2.
  - AC2 (decide whether it belongs in the default suite; opt-in option): D3 and task 1.4.
  - AC3 (robust alternative, not a loosened threshold): D2 and task 1.3.
  - AC4 (20+ green runs under contention): task 2.2.
  - Driver constraints: FirstRunRoutesSpec/heap reporting is task 2.4, the forbidden files are C4, and the worker cap
    and PID-only kills are C2.
  - No AC is left uncovered, and there is no scope drift into product code or CI.

- **Opt-in mechanics.**
  - `HELIO_MEASURE` does not exist anywhere yet; my grep of `*.scala`/`*.sbt`/`*.md` outside this change returned
    empty, so the name really is introduced here, as the premise and design say.
  - Tests fork (`build.sbt:101`), and the `testGrouping` ForkOptions pass `envVars = (Test / envVars).value`
    (`:200`). Whether the parent env reaches the fork is a live question, and the design correctly makes verifying
    it an explicit task (1.4).
  - `assume`/`cancel` for skipped tests is an existing repo pattern (`SqlConnectorTlsSpec.scala:59`,
    `PinnedPoolReuseSpec.scala:79`).

- **No placeholders or contradictions.** Proposal, design and tasks agree on the order D1 → D2 → D3 → D4, and every
  task has an acceptance signal. `skip_specs: true` is appropriate for a test-only change with no API or schema
  delta.

### Verdict: CONFIRM

### Non-blocking notes

1. **H1 is a weak explanation for a p50 shift. Pre-register a competing hypothesis so P2 can tell them apart.** The
   p50 of 20 samples is the 10th sorted value. Warm-up that inflates only the first few "before" samples barely moves
   it, and an 11ms median gap needs most of the before phase to be slow. H2, non-stationary contention, fits better:
   the two phases are sequential ~0.5-1s windows that sample different load or GC conditions. Under H2, swapping the
   order would not make the failure go away; it would just move which side gets hit. D1 currently says "if P2
   refutes H1, stop and report", which could cost an avoidable round-trip. Recommendation: state H2 up front, and
   have the probe distinguish the two. Per-sample arrays already help (look for front-loaded outliers versus outliers
   spread across the phase). An interleaved before/after variant would be the cleaner discriminator. Either way, D2
   removes the wall-clock comparison, so the fix does not depend on which hypothesis wins. The probe is about stating
   the root cause honestly.
2. **The ">200ms" PR-body trigger.** The artifacts say "HEL-1096 set no latency bound". More precisely, HEL-1096 D2
   set a *reporting* trigger (p95 growth >200ms is a PR-body finding) that was never a test gate. Consider having
   D3's `HELIO_MEASURE=1` mode print a clearly labeled report line when p95 growth exceeds 200ms. It would still be
   report-only, so the opt-in measurement keeps that intent faithfully.
3. **Strengthen D2 beyond size.** Asserting the denied entries' pipeline ids equal the 2 seeded AI pipelines, with
   reason code `ai-step`, rules out a coincidental count of 2 from a different defect for free. Optionally, asserting
   debounce rows exist for the 3 allowed pipelines proves the *allowed* half of the awaited evaluation ran too.
4. **The before == 0 assertion is tautological.** `serviceBefore` has a null trigger service and can never produce
   denials. Keeping it as documentation of the contrast is fine, but the evaluator should not count it as guard
   evidence. The after == 2 half is the guard.
5. **D3's warm-up count is unspecified** ("discarded warm-up iterations"). Name a number. It is report-only, so this
   does not block.
6. **The proposal states the mechanism as fact before it has been probed.** proposal.md "Why" says "that phase absorbs
   JVM/pool/PG warm-up" as fact. It is H1, which is still to be confirmed. Update the wording after P2.
