## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit reviewed: `e1978270`. Every finding below is from my own runs and my own
reading of the production code. `audit-report.md` and `evaluation-1.md` were read
as claims only.

### What I verified (with evidence)

**Census / rename completeness (AC1, AC3).**
- `grep -rn "\.insert(" backend/src/main` — only `dataSourceRepo`/`panelRepo`/
  `dashboardRepo`/`userRepo`/`permissionRepo`/`alertRuleRepo`/`imageUploadRepo`.
  Zero production callers of the step-repo method. Confirms the premise.
- `grep -rn "stepRepo\.insert(\|pipelineStepRepo\.insert(\|StepRepo\.insert("
  backend/src` → **0**. No leftovers.
- `grep -rn insertRootStep backend/src` → 27 hits: 1 definition
  (`PipelineStepRepository.scala:74`), 10 `PipelineAnalyzeRoutesSpec`, 9
  `PipelineRunRoutesSpec` (one of which is the rewritten HEL-922 comment at
  ~line 485, so 8 calls), 7 `PipelineStepRepositorySpec`. 8+10+7 = **25
  rename-only call sites**, which reconciles exactly with the report's
  33 = 25 + 8. The census arithmetic holds.
- `insertRootStep`'s signature has **no** `parentStepId` parameter, defaulted or
  otherwise (read at `PipelineStepRepository.scala:74`). Scaladoc states root-only
  and points at `insertInternal`. AC3's literal wording is met.

**Position semantics — the one changed expectation (AC5, review item 3).**
Re-derived, not accepted: `insertRootStep` takes `max(position) where
parentStepId IS NULL` (line 86), `insertInternalAction` takes
`siblingsQuery(pipelineId, parentStepId).map(_.position).max` (line ~215) — genuinely
per-parent. A first trunk child is therefore position 0, so `Vector(0, 0)` is the
correct value and `Vector(0, 1)` described the old parallel-root shape. Confirmed
`executionOrder` (lines 754-780) orders by the `parent_step_id` tree
(`rootTrunk.flatMap(walk) ++ rootTails`), using `position` only as the
trunk/tail discriminator (`position == 0`) — never as a global sort key. This is
D3 case (a), not a product defect. The `Vector(0,1) → Vector(0,0)` change is the
**only** changed expectation in the whole diff and it carries a stated, correct
reason. Every other hunk is topology-or-rename only (checked hunk by hunk).

**Fixture-inertness claim for the design's original WorkspaceContext mutation.**
Verified from source: `createSource` seeds
`Vector(StaticColumnPayload("value", "string"))`
(`WorkspaceContextServiceSpec.scala:194`) and the step is
`SelectConfig(Vector("value"))` — a schema-identity no-op. The schema-threading
mutation genuinely cannot be observed by this fixture. Not mutation shopping.

**Mutation 4 reproduced by me (RED).** Applied the report's replacement mutation —
`PipelineStepRepository.executionOrder`'s `walk`, `node +: (tails ++ …)` →
`(tails ++ …) :+ node`:
`sbt testOnly …WorkspaceContextServiceSpec -- -z "outputColumns in step order"`
→ `Tests: succeeded 0, failed 1`. This replacement attacks trunk traversal order,
which is literally the "in step order" claim in the test's name. Correctly
targeted, and stronger than the design's assigned target.

**Baseline green.** `sbt testOnly` over all four touched specs (unmutated):
`Total number of tests run: 113 … succeeded 113, failed 0`. No Flyway validation
failure on the shared dev Postgres.

**Scope.** `git diff main...HEAD --name-only`: exactly the 5 source files plus this
change directory. Zero `*.png`, zero `.concertino/**`, no migrations, no schema or
spec deltas. Working tree left clean (`git diff HEAD` empty) after all probes.

---

### The finding: a seventh false-coverage claim, in the AC4 deliverable itself

I ran the one leg of the 468/469 conjunction that neither the executor nor the
evaluator ran directly (the evaluator corroborated it by code reading only).

Mutation applied **alone**, at `PipelineRunService.scala:403` inside
`previewAtNode` (the second, identical `slicedSteps` line at 542 is the HEL-947
backfill path and was left untouched):

```
val slicedSteps = pathToRoot(target, Vector(target))   →   val slicedSteps = sortedSteps
```

- `sbt testOnly …PipelineRunRoutesSpec -- -z "only applies steps up to"` under the
  **corrected trunk topology**: `succeeded 1, failed 0` — **GREEN**.
- `sbt test` (full backend suite) with that same mutation in place:
  **`Total number of tests run: 3606 … succeeded 3606, failed 0`** —
  the entire suite is green while `previewAtNode` applies every step in the
  pipeline instead of only the prefix up to the target.

So: after this ticket's fix, the prefix-slicing mechanism at
`PipelineRunService.scala:403` — the exact property named in the test
"preview only applies steps up to and including the target step" — is
**unguarded by the whole backend suite**. Combined with the evaluator's measured
"drop node-keyed lookup alone → green under both topologies", the corrected test
is red only under a *compound* break of two independent mechanisms, and guards
neither of them on its own.

`audit-report.md` section 1 does disclose the widen-alone green result, but then
characterises it as **"a genuine measurement error"** and files the compound
result as **"Bucket 1: was-vacuous, now-guarded."** Both are wrong in the same
direction. The widen-alone green is not a measurement error; it is a substantive
coverage finding — the assertion cannot observe that mechanism at all. And
"now-guarded", unqualified, tells a reader that this test now covers the prefix
walk. It does not. The AC4 section then repeats the claim: 468/469 "is now
genuinely exercised under the corrected trunk topology."

This is exactly the failure class HEL-949 was filed against — a confidently
worded, well-formatted claim of coverage that the code does not have — reproduced
inside the ticket's own primary deliverable. Design D5 makes the audit report a
deliverable, not a side effect, and the ticket's Evidence bar requires stating
plainly when a test "was not testing what it claimed." The evaluator identified
this wording gap and, in my judgment, under-weighted it as non-blocking. The
underlying code work is sound; the deliverable's account of it is not.

I am **not** asking for a code change, a different mutation, or a re-run. The
change requests below are corrections to the written record.

### Rulings on the other focus items

- **Focus 1 (mutation shopping).** No shopping. Both replacements are minimal
  derivatives of the design's own assigned target with root causes I reproduced or
  re-derived. Replacement 4 tests the property the test name claims (order).
  Replacement 1 nominally targets the same prefix walk, but only in conjunction —
  see above.
- **Focus 2.** Ruled: "was-vacuous, now-guarded" is **not** an honest unqualified
  label for 468/469, and the omission is material in the AC4 deliverable. CR1/CR2.
  The bucket-1 *classification* itself is correct against its literal definition
  and I am not asking for it to change.
- **Focus 3.** Every changed datum answers "why did this need to change?" Only one
  expectation changed and its reason is stated and correct. No rubber stamp. One
  nit: the `outputColumns` assertions were already present before this change
  (only re-shaped into a single vector), so "re-expressed the ordering claim
  against `outputColumns`" slightly oversells a rewording — but mutation 4 earns
  the substantive claim, and the report says so itself. Non-blocking.
- **Focus 4 (literal AC wording).** AC1 exceeded (33 sites over 4 files vs. the 2
  files named), and the report reconciles the ticket's own "13 known"/12-listed
  discrepancy. AC2, AC3, AC5 met. AC4 met in form (yes/no answered, negative case
  stated outright for all 25 single-step sites) but overstated in substance for
  468/469.
- **Focus 5 (trap disarmed).** Yes. `insertRootStep` cannot chain and its scaladoc
  says so. `insertInternal`/`insertInternalAction`/`insertAtInternal` remain the
  only chaining-capable writers and all take an explicit `parentStepId`. Residual
  (non-blocking): `insertInternal`'s `parentStepId` still defaults to `None`, so
  two defaulted calls reproduce the same parallel-root shape — but that parameter
  is visible in the signature the new scaladoc directs authors to, which is the
  material difference from the old `insert`.
- **Focus 6 (scope).** Clean. 25 rename-only sites; no bulk sed; no PNGs; nothing
  under `.concertino/**`.

### Verdict: REFUTE

### Change Requests

1. **`audit-report.md` section 1 — retract "measurement error" and state the
   compound.** Replace the characterisation of the widen-alone green result as
   "a genuine measurement error" with what it actually is: evidence that the
   assertion cannot observe `previewAtNode`'s prefix slicing while the HEL-905
   node-keyed lookup at `PipelineRunService.scala:423` is intact. State plainly
   that the recorded mutation is a **compound** break, and that neither half alone
   is red under either topology (measured: widen-alone green/green;
   drop-node-keyed-lookup-alone green/green — the latter is the evaluator's
   measurement, recorded in `evaluation-1.md`).

2. **`audit-report.md` section 1 + the AC4 section — qualify the bucket-1 label.**
   Keep the bucket-1 classification (it meets the literal definition), but replace
   the unqualified "now-guarded" / "now genuinely exercised" wording for 468/469
   with the qualified form: the assertion is guarded by the *conjunction* of the
   prefix walk and the node-keyed lookup, and does not independently guard the
   prefix walk. 544/545 and 346/347 are unqualified bucket 1 and should stay that
   way — the distinction between them and 468/469 is the point.

3. **Record the coverage hole I measured, and dispose of it explicitly.** Add to
   `audit-report.md`: the full 3606-test backend suite is GREEN with
   `PipelineRunService.scala:403`'s `slicedSteps = pathToRoot(target,
   Vector(target))` replaced by `sortedSteps` — i.e. `previewAtNode`'s
   prefix-slicing mechanism has no suite-wide guard. The report's current
   "No genuine product defect … no spinoff ticket is warranted from this ticket's
   findings" is therefore incomplete: this is not a product defect, but it is a
   real, measured coverage hole surfaced by this audit. Either file a spinoff
   ticket for it or state an explicit, reasoned deferral naming the mechanism and
   the file:line. Do not leave it unrecorded.

4. **`audit-report.md` D3 section — fix the stale "both".** "produced exactly ONE
   red assertion, both anticipated by design.md" is a leftover from an earlier
   draft (also flagged by the evaluator). Trivial, but this deliverable's whole
   value is that its wording can be trusted literally.

### Non-blocking notes

- Worth one sentence in the report that the 4 corrected sites moved from
  `insert(..., dummyUser)` (RLS user-context write) to `insertInternal`
  (ACL-bypassing system context), so the privilege change is visible rather than
  incidental. No coverage is lost — `PipelineStepRepositorySpec`'s untouched
  non-owner tests still cover insert-time ACL — but the change should not be
  silent.
- `insertInternal`'s scaladoc still says "No live caller passes a non-`None`
  `parentStepId` yet (P1.2 wires branch creation)". Tests now do; if "live" means
  production this is still accurate, but it reads as stale.
- `PipelineAnalyzeRoutesSpec` 234/235's `inputSchema` assertion is left as "no
  claim made" because ScalaTest short-circuits at the preceding `size 1` failure.
  By inspection it is topology-independent anyway (the disabled `rename` is
  filtered out before schema threading in both shapes, so `select`'s `inputSchema`
  is the source schema either way), so the honest answer for that half is
  "not topology-dependent" rather than "unknown". Optional to add.
