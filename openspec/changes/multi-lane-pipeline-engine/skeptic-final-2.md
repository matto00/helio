## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### What I verified (with evidence)

**1. THE ROUND-1 FIX, VERIFIED BY MY OWN MUTATION — both legs fail INDEPENDENTLY.**
This was the priority and it holds. I neutralized `rewriteLaneClientId`'s effect in
`PipelineService.scala` (replaced its `typedConfig match` dispatch with `Right(typedConfig)`,
so a lane-kind `secondaryInput` is persisted unrewritten — the exact pre-fix state) and ran the
replacement test twice:

- **Leg (a), persisted state, alone:**
  `Lane("laneB") was not equal to Lane("fc3eb9d9-4c86-49e2-bb0d-bc09b40dc426") (PipelineCreateTransactionalSpec.scala:421)` — FAILED.
  The failure message is literally the defect: the clientId persisted where the real step id belongs.
- **Leg (b), behaviour, alone:** I then *removed leg (a)'s two assertions* under the same
  mutation, so leg (b) was reached on its own:
  `com.helio.domain.engine.LaneReferenceError: Step 'a5c3fe1b-…' references lane step 'laneB', which does not exist in this pipeline.` — FAILED.

Neither leg is carried by the other; this is not a conjunction guarding neither. Leg (b)'s
failure mode is a thrown `LaneReferenceError` from `InProcessPipelineEngine.executeTree`'s
up-front `laneViolation` check (`InProcessPipelineEngine.scala:316-328`, `Future.failed`), not a
soft assertion, so it cannot pass vacuously. Both mutations reverted; `git status --porcelain`
is empty and `testOnly PipelineCreateTransactionalSpec` is 14/14 green on the restored tree.

**2. The fix mirrors `parentStepId` at the same site, and covers every clientId-bearing write path.**
`rewriteLaneClientId` resolves through the same `clientIdMap` one line below
`parentClientIdOpt.map(clientIdMap(_))`. I checked the proposal-apply path is not a second,
unfixed instance: `PipelineProposalService.createPipeline` delegates to
`pipelineService.create(CreatePipelineRequest(...))`, i.e. straight through `buildStepsAction`,
so it inherits the fix rather than duplicating the bug. The patch-set path
(`PatchSetApplyForward.scala:88`) delegates to `pipelineService.updateStep`, which calls
`validateLaneReference` (`PipelineService.scala:1224`) — so contract 6a's write-time arm holds
on all three paths. (`PatchSetApplyResolvers.validateEmbeddedStepReferences` is itself
lane-blind, but it is a pre-flight redundancy, not the write gate — note below.)

**3. The second finding's adjudication is SOUND. I checked all three claims literally.**
- `validateLaneReference` (`PipelineService.scala:1477-1494`) constrains exactly three things —
  not-self, exists, not-ancestor. **No ordering constraint of any kind.** The request-scoped
  mirror `validateLane` (`:230-242`) is the same three checks. Verified by reading, not by report.
- At base `a9d1bdcd`, `PipelineService.scala:252` reads *"it must be an earlier step's clientId
  in this same request"* and `PipelineProposalService.scala:202` reads *"must be an earlier
  step's clientId in this same proposal"* — both **verbatim, pre-existing**. Claim confirmed.
- Therefore this is a request-body encoding convention applied to a new field, **not** an engine
  narrowing. I independently confirmed the expressivity escape hatch exists: both `addStep`
  (`:1002`) and `updateStep` (`:1224`) validate lanes, so any graph unbuildable in one call
  (e.g. `A.lane→B` where `B.parent=A`, which is order-unsatisfiable in a single fold) is fully
  buildable incrementally. Nothing is permanently unauthorable. **HEL-912/913/914 are safe to
  plan against items 6/6a as written.**
- I also **empirically verified the documented forward-reference behaviour** with a throwaway
  probe (added, run, removed): a forward lane reference returns
  `Left(BadRequest(Step 'rejoin' has a lane secondaryInput referencing 'laneB', which is not an
  earlier step's clientId in this same request -- a forward lane reference is not yet supported
  via this single-call create path))`. Named, identifies the clientId, nothing persisted
  (transactional create is all-or-nothing). Contract 6b describes reality.

**4. All gates re-run by me, as CI invokes them.**
- `sbt test` → `Total number of tests run: 3659`, `succeeded 3659, failed 0`, EXIT=0.
  `FlywayNonSuperuserMigrationSpec` appears at log line 440, so the migration gate really ran.
- `npm run lint` 0 · `npm run typecheck` 0 · `npm test` 252 suites / 2590 tests passed ·
  `check:schemas` 0 (7 + 14 surfaces) · `check:openspec` 0 · `check:scala-quality` clean
  (147 soft warnings, pre-existing).
- `tools/check-delta-headers.py` → 0 mismatches; `tools/check-legacy-field-coverage.py` →
  0 uncovered; `openspec validate multi-lane-pipeline-engine --strict` → valid.

**5. P1.2 parity (CR1 restore) still anchored after cycle 3.** `git diff b09ceb48..HEAD` touches
only `PipelineService.scala` + its spec + planning docs — the engine was not retouched.
`InProcessPipelineEngine.scala:390` and `PipelineRunService.scala:929` still compute the key
from the *identical* `trunkOf(steps).lastOption.map(_.id.value)` expression, with the documented
no-trunk fallback to the root frame. Structurally unchanged from round 1's mutation-verified state.

**6. V97.** Bracketed `NO FORCE` / `FORCE ROW LEVEL SECURITY` (the v0.7.8/9/10 shape), each
UPDATE scoped `op = '<op>' AND config::jsonb ? '<legacy field>'` so non-matching rows are
excluded from the row set entirely — byte-identity is structural, not asserted. No lane-kind
output is ever invented. The two real empty-id `lookup` drafts at `hel904-real-dump.sql:10163`/
`:10230` survive as `{"kind":"source","dataSourceId":""}` via `COALESCE(... , '')`. Idempotent by
construction (the predicate is false after rewrite). All asserted inside the non-superuser gate.

**7. Three-way distinction, all three simultaneously.** `SecondaryInput.decodeStrict`: legacy
flat field present → named `StepConfigTypeMismatch`, checked **before** `secondaryInput` is read
(so legacy + valid new shape still errors); `None | Some(JsNull)` → `Default = Source("")`;
present-but-malformed → named error from `format.read`. Matches Decisions 1a/1b exactly.

**8. Engine contract vs. what shipped, six commits in.** I re-read all twelve items against the
code. Items 1–5, 7–12 hold. Item 6a now holds on all three write paths (the round-1 hole is
closed and mutation-proven). Item 6b is accurate and honestly framed — and, unusually for a
caveat, it records the *measured* cost of lifting the limitation rather than hand-waving it.
The narrowed analyze clause is correct: `secondarySchema` is populated only from
`laneDependencyOf` → `results`, and `laneDependencyOf` (`PipelineAnalyzeService.scala:194-205`)
returns `Some` **only** for `SecondaryInput.Lane`, so a source-kind input can never be derived —
exactly what the delta now says, with HEL-965 tracking the remainder. **The contract has not
drifted from the code.**

**9. UI.** No visual surface to judge: `git diff a9d1bdcd..HEAD -- frontend/src` filtered for
`className` / `style=` / JSX tags / CSS / `--app-*` tokens / px/rem returns **zero lines**. The
frontend change is a type widening plus hook state, covered by the jest suite I re-ran. Cycle 3
touched no frontend file at all. I did not start the servers; there is no changed view, so a
screenshot would be of an unchanged screen. DESIGN.md has no applicable surface here.

### Verdict: CONFIRM

The round-1 defect is genuinely fixed, and the test guarding it is genuinely failable on each
leg separately — I broke it myself, twice, in isolation. The un-fixed second finding is
correctly adjudicated on claims I verified verbatim against the base commit. Ships.

### Non-blocking notes

1. **The forward-lane-reference rejection branch has no test.** I verified the behaviour by
   probe (it is correct today), but nothing in the suite pins it. This is the sibling case of the
   exact defect this ticket already shipped once — a future refactor that "simplifies" the `Left`
   arm back into `Right(typedConfig)` would silently restore the unrunnable-row bug, and contract
   6b would become false with no gate noticing. Cheap to add; worth doing in HEL-914's cycle.
2. `PatchSetApplyResolvers.validateEmbeddedStepReferences` (`:197`) checks only
   `secondaryDataSourceId`, so a lane-kind input gets no pre-flight validation there. Harmless —
   `updateStep` is the actual write gate and does validate — but the function's comment claims it
   uses "the same shared extractor PipelineService.addStep/updateStep use," which is now only
   half true for lanes.
3. All four of round 1's non-blocking notes are still present and unaddressed (they were
   non-blocking, so this is not a change request — only so they are not lost):
   `FlywayNonSuperuserMigrationSpec.scala:164` still cites the nonexistent
   `V97Hel911MigrationCoverageSpec`; `PipelineService.scala:932` and
   `PipelineAnalyzeService.scala:177` still describe `InvalidGraph` behaviour that no longer
   exists; `openspec/specs/pipeline-execution/spec.md:156` resolves at archive.
