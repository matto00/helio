## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round-2 CR1 (25-not-29 arithmetic) — FIXED, and the numbers are now internally
consistent everywhere.** `grep -n "29\|25\|33\|four\|two\|8"` across design.md,
tasks.md and proposal.md returns no surviving `29`. Every occurrence is coherent
with the one true accounting: **33 sites / 4 tests / 8 corrected sites / 25
untouched sites** (design.md:31, 83, 96, 116, 117, 120, 285, 302; tasks.md:6, 45,
83, 103; proposal.md:19). The sites-vs-tests distinction is now stated explicitly
at design.md:83-86 ("Tests and sites are counted separately throughout"), which is
the right structural fix for a defect that recurred in both prior rounds.

**Census re-verified independently (not taken on trust).** Per-file counts of
`\b[a-zA-Z]*[Ss]tepRepo\.insert\(`:
`PipelineRunRoutesSpec` 12, `PipelineAnalyzeRoutesSpec` 12,
`PipelineStepRepositorySpec` 7, `WorkspaceContextServiceSpec` 2 = **33**. The
`PipelineRunRoutesSpec` line list is exact: 424 455 468 469 544 545 559 600 623
716 876 952 — matching design.md's table line-for-line. (Note the ticket's AC1
says "13 known" and then lists 12; the plan's 12 is the correct figure.)

**Round-2 CR3 (unconditional-four-reds vs AC4's negative case) — FIXED.** D2a
(design.md:160-176) now defines two admissible outcomes, makes a not-red result a
mandatory AC4 report entry, and forbids mutation-shopping; task 4.2 was rewritten
to match ("record the result per test — red with actual failure output, or
green"). Binding decision and task now agree.

**Round-2 CR2 (D2 rescoped to four tests / two mutation targets) — PARTIALLY
fixed. The two-target table now exists, but one of its two assignments names a
mutation that provably CANNOT fail the test it is assigned to.** I checked what
each named mutation actually scans rather than trusting the table:

- *Preview group, path exists as named.* `previewAtNode`
  (`PipelineRunService.scala:327`) and its inner `pathToRoot`
  (`PipelineRunService.scala:398-403`, `val slicedSteps = pathToRoot(target,
  Vector(target))` at :403) are real. The named mutation ("execute all of the
  pipeline's steps rather than only the target's ancestor path", i.e.
  `slicedSteps = sortedSteps`) is implementable.
- *It works for 468/469.* That test (`PipelineRunRoutesSpec:464-475`) inserts
  `select` (the target) then `limit(1)`. Chained, the target's ancestor path is
  `[select]`; the mutation widens it to `[select, limit(1)]`, so
  `resp.rowCount shouldBe 2` becomes 1 → RED. Under the old parallel-root shape
  the widened slice is the same two independent roots and the assertion is
  satisfied for free → GREEN. A genuine was-vacuous/now-guarded demonstration.
- *It cannot work for 544/545.* That test
  (`PipelineRunRoutesSpec:540-552`) inserts `limit(1)` **disabled**, then
  `select` (the target). Once chained, the target is the leaf of a two-step
  pipeline, so `pathToRoot(target)` **already equals the whole step set**. The
  mutation `slicedSteps = sortedSteps` is a literal no-op for this fixture; the
  test stays green under it by construction, not by topology-insensitivity.
- *The mechanism 544/545 actually covers is elsewhere.* Its own leading comment is
  "HEL-412 (design.md Decision 3): the preview prefix skips disabled steps", and
  `previewAtNode`'s comment at :392-394 says outright "Disabled ancestors are NOT
  pre-filtered here — the engine's own in-place skip (Decision 7) handles them".
  That skip is `InProcessPipelineEngine.scala:325`:
  `if (step.enabled) evalOneStep(currentRows, step, ctx) else Future.successful(currentRows)`.
  Breaking *that* (execute the step regardless of `enabled`) makes the chained
  shape run `limit(1)` → `rowCount` 1 → RED, while the old parallel-root shape
  never has the disabled step in its slice at all → GREEN. That is the correct
  mutation for this test, and it is a different production line from the one D2
  assigns it.

**Analyze group — the named path is real and at least one arm can fail.**
`PipelineService.scala:408` `val steps = allSteps.filter(_.enabled)` and
`listByPipelineInternal`'s `executionOrder` traversal both exist; dropping the
`enabled` filter would take `PipelineAnalyzeRoutesSpec`'s `resp.steps should have
size 1` to 2 → red. So that row is not a fake gate. The `executionOrder` arm,
however, is inert for `WorkspaceContextServiceSpec:346/347` for the same reason as
above (insertion order and traversal order coincide for a 2-step trunk) — see CR1's
per-test requirement.

**D3 re-checked.** The `Vector(0, 1)` → `Vector(0, 0)` prediction and its
per-parent-position reasoning are correct (`insertInternalAction`'s sibling-scoped
`position`), and both case-(a)/case-(b) branches are specified with an explicitly
unacceptable resolution named. Round 2's finding that 5.4 is case (a) holds; the
plan correctly still requires the executor to re-derive it. D3's recorded
row-count prediction (both `rowCount shouldBe 2` stay 2) is right for 468/469 and
544/545 under the corrected shape.

**D4/D5/D6 reviewed fresh.** D4's rename beats both rejected alternatives on
stated grounds, is compiler-enforced, and 6.3 preserves rather than deletes the
HEL-922 signpost (AC3 satisfied literally). D5 makes AC1 and AC4 file deliverables
including the negative case (AC4's literal wording satisfied). D6 constrains the
*mechanism* at the 25 untouched sites ("the ONLY permitted edit is the mechanical
rename"), not merely the outcome, and task 8.3 makes that diff-checkable. AC2 maps
to tasks 3.1-3.5, AC5 to 8.1. I found no uncovered AC and no scope drift.

### Verdict: REFUTE

Two of round 2's three CRs are genuinely fixed in the binding decisions, the
arithmetic is finally consistent, and D3/D4/D5/D6 hold up under fresh reading. One
blocking defect remains, and it is the exact failure class this ticket exists to
correct: D2 assigns `PipelineRunRoutesSpec` 544/545 a mutation that cannot fail it,
and D2a's (otherwise correct) anti-mutation-shopping rule then converts that
inert mutation into a **false** "still topology-insensitive after correction"
AC4 entry for a test that is in fact genuinely guarded once chained. A fake gate
recorded as a finding is worse than no finding.

### Change Requests

1. **D2's mutation table must assign each of the four tests a mutation
   demonstrated capable of failing *that* test under the corrected topology, and
   the 544/545 assignment must change.** Split the preview row in two:
   - `PipelineRunRoutesSpec` 468/469 — keep the prefix-walk mutation
     (`PipelineRunService.scala:403`, widen `slicedSteps` to all steps). Verified
     red-capable.
   - `PipelineRunRoutesSpec` 544/545 — the property under test is the engine's
     in-place **disabled-step skip**, not the prefix walk. Assign
     `InProcessPipelineEngine.scala:325` (`if (step.enabled) evalOneStep(...)`);
     the mutation is to execute the step regardless of `enabled`. Record in D2 the
     reason the prefix-walk mutation is *not* usable here (for this fixture the
     target is the leaf, so `pathToRoot(target)` already equals the whole step
     set — the mutation is a no-op), so the same mis-assignment is not
     re-derived later. Update task 2.1/2.2 to match: three mutation targets, not
     two.
2. **D2a must distinguish "green under a justified mutation" (a real finding) from
   "green under a mutation that could never have gone red" (a measurement error).**
   As written, D2a forbids changing the mutation at all, so an inert target is
   silently laundered into an AC4 finding. Add: before recording the
   "still topology-insensitive after correction" outcome for any test, the
   executor must state why the applied mutation *could* have failed it (which
   assertion would have changed value); if it could not have, that is a
   mis-specified mutation to be corrected and reported as such — not a finding.
   The anti-shopping rule then stands where it belongs: it forbids trying further
   mutations after a *justified* one comes back green. This also covers
   `WorkspaceContextServiceSpec` 346/347, where D2's `executionOrder` arm is
   likewise inert (traversal order and insertion order coincide for a two-step
   trunk), and where the `enabled`-filter arm does not apply at all since neither
   of its steps is disabled.

### Non-blocking notes

- D5's second bullet ("for each changed test: the mutation applied, the RED output
  ... and the GREEN-under-mutation output under the old topology") still presumes
  the red/green pair and does not mention D2a's second bucket. D2a governs, but
  aligning D5's wording while fixing CR1/CR2 would remove the last residue.
- The ticket's AC1 says "13 known" and lists 12 line numbers; the plan's 12 is
  correct and the discrepancy is the ticket's, not the plan's. Worth one sentence
  in the audit report so a reviewer does not read the 12-row table as short.
