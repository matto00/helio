## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the tree, the diff, or a command I ran
myself; the executor's and evaluator's reports were read only as claims to check.

### What I verified (with evidence)

**Diff surface.** `git diff --stat 824aa914...HEAD` — 8 backend files + openspec artifacts.
**Zero `frontend/**` files.** UI/design judgment (§4 of my brief) is therefore not applicable
and no browser session was run; correspondingly, no frontend gate is cited by me or by
`files-modified.md` (gates-scan-nothing lesson satisfied — that section explicitly declines to
cite `npm run lint/typecheck/test/build`).

**AC1/AC2/AC3 — code read in full.** `PipelineStepConfigCodec.secondaryDataSourceId`
(`PipelineStepConfigCodec.scala:102-107`) is the single extractor; all five ACL sites route
through it: `PipelineService.scala:215` (validateStepCrossOwnerRefs), `:867` (addStep),
`:1073` (updateStep), and `PatchSetApplyResolvers.scala:197` (the join/union/lookup triad,
collapsed to one arm).

**Literal-AC check (lesson 2).** The guard is `.nonEmpty` on the raw string at all three arms —
**not** `.trim.nonEmpty`. Confirmed by reading `:103-105`; the deliberate choice is documented
in the scaladoc, and `PipelineStepConfigCodecSpec` carries a whitespace-is-not-trimmed test.

**Mechanism constraint (lesson 3).** Error strings are byte-identical to base: base emitted
`s"Data source not found: ${jc.rightDataSourceId}"` → now `s"Data source not found: $id"` where
`id` IS that field; patch-set base `s"edit $index: data source not found: ${…}"` → same with
`$id`. For any non-empty id the extractor returns `Some(thatExactString)` and the same
`findByIdOwned` runs, so no non-empty path changed behavior. The old join→union→lookup
`flatMap` chain is behaviour-equivalent to one lookup (a config is exactly one type).

**Lesson 1 — changed test data.** `git diff 824aa914...HEAD -- backend/src/test/ | grep '^-'`
returns exactly **one** removed line: an `import` in `PipelineStepRoutesSpec` (widened). **No
pre-existing assertion, expected value, or fixture was changed** — additions only. The
evaluator's claim is true.

**Full backend suite, re-run by me** (not cited from the evaluator):
`sbt -batch test` → `Total number of tests run: 3623 … succeeded 3623, failed 0 … All tests
passed. [success] Total time: 241 s`. Matches the reported 3623 exactly. Tree was clean
(`git status --porcelain` empty) before and after.

**Area 1 — the audit's blind spot, checked BOTH ways.**

*(a) Is the caveat recorded in generalizable form?* Yes. `proposal.md:78-86` names the
mechanism failure, not the file: "a call site reaching the ownership check through a HELPER is
invisible to it … a future sweep of this kind should key on the PROPERTY (an ACL check against
a config-supplied id) rather than on one function name." It is not softened into "we missed one
file" — it states the audit's *findings* still hold while its *method* would not have found the
fifth site. That is what a future reader needs.

*(b) I ran the corrected, property-keyed search myself, looking for a SIXTH site.* Three
independent sweeps:
- All references to the three second-source fields anywhere in `backend/src/main`: only the
  extractor, `SparkJobSubmitter:242`, and prose.
- All 34 files calling `findByIdOwned`, inspecting every candidate that could receive a
  config-supplied id: `PipelineProposalService` (checks the pipeline's *primary* `sourceId`,
  not a second source), `PatchSetPreviewProjection:251` (primary `sourceDataSourceId`),
  `PatchSetUndoConflictCheck` (journaled ids, not config ids).
- All `PipelineStepConfigCodec.decode` call sites (the only way a `*Config` becomes typed):
  `PipelineStepRepository:787`, `PipelineService:255/752/799/1204`,
  `PatchSetPreviewProjection:288`, `PipelineProposalService:209` — none performs an ownership
  check on a second-source id. `PipelineProposalService.apply` reaches step creation via
  `pipelineService.create` → `createTransactional` → `validateStepCrossOwnerRefs`, i.e. site 3,
  already fixed.
- `UnionStep`/`LookupStep`/`SparkJobSubmitter` use `findByIdInternal` at execute time by
  documented design (HEL-278's "pre-flight owned + runtime internal" model) — not ACL sites,
  and their unset-id behavior is an explicit Non-goal.

**Conclusion: there is no sixth site.** FIVE is the true, complete total.

**Area 2 — discrimination, verified by my own mutation, not by transcript.**
I restored the *unguarded* join and union arms at the `PatchSetApplyResolvers` site **only**
(shared extractor and all four other sites untouched) and ran the suite:

```
- should accept a pipelineStep-update edit clearing JoinConfig.rightDataSourceId to empty (HEL-950) *** FAILED ***
    expected success (empty id skips the ACL check), got Left(NotFound(edit 0: data source not found: ))
- should accept a pipelineStep-update edit clearing UnionConfig.otherDataSourceId to empty (HEL-950, the cell HEL-620 missed) *** FAILED ***
    expected success (empty id skips the ACL check), got Left(NotFound(edit 0: data source not found: ))
Tests: succeeded 30, failed 2
```
Both foreign-owned tests (7.9d join, the new union one) stayed **green** under the same
mutation — so the empty-id leg and the ownership leg are guarded **independently**, not only in
conjunction (lesson 5 / AC5 satisfied at this site by direct observation). Mutation reverted;
suite re-run green.

I also ran `PipelineStepSecondSourceGuardSpec` and read it: it is non-vacuous — it iterates the
real `PipelineStep.Registry`, asserts `Registry.size shouldBe 23` and
`foundSecondSourceFields shouldBe 3` as positive baselines, `fail`s loudly on a non-`Product`
decode rather than skipping, and asserts the exact `kind -> field` map, not just a count.

**Second non-discriminating item? None found unlabelled.** The one non-discriminating item
(AC6b's union UI walkthrough) is correctly and prominently labelled in `evaluation-2.md` §"AC6b's
evidence DISCRIMINATES? — No". The only other non-new evidence in the five-site table is the
foreign-owned column's `pre-existing 7.9d` and `pre-existing :292`, both explicitly labelled
"pre-existing" — correct, since the ACL leg for non-empty ids deliberately did not change, so
those are regression guards by intent, not proofs. Every *empty-id* cell in the table is a new
test at that site that base code would fail (base join arms were unconditional at all four
non-lookup cells) — discriminating by construction, and I confirmed two of them empirically.

**Pre-commit bypass honesty.** `files-modified.md`'s final section states plainly that
`git commit -n` skips "husky's ENTIRE pre-commit hook (all 17 steps), not just one step",
names the actually-blocking step (`check:helio-mcp-types`, missing `helio-mcp/node_modules` in
this worktree — environmental, no `helio-mcp/**` file in the diff), and lists the
diff-relevant checks re-run manually. That is honest and matches what I could verify (I
independently re-ran the heaviest of them, the full `sbt test`).

**Test count.** `PatchSetApplyServiceSpec` gained exactly **three** tests (join-empty-accepted,
union-foreign-rejected, union-empty-accepted); the pre-existing 7.9d join foreign-owned test is
unmodified and not counted. The corrected count of 3 is accurate.

### Verdict: CONFIRM

### Non-blocking notes

1. `proposal.md:94` (Non-goals) still reads "beyond the four call sites named above" — a stale
   count left over from before the fifth site was found. Everything else in that document was
   updated to five. Cosmetic; worth a one-word fix if the proposal is quoted later.
2. `PipelineProposalService.validateSteps` performs no second-source ACL check of its own; it
   is safe today only because `apply` funnels through `PipelineService.create` →
   `validateStepCrossOwnerRefs`. That indirection is exactly the shape that hid the fifth site.
   Not a defect and not in scope, but a one-line comment there pointing at
   `validateStepCrossOwnerRefs` would make the reliance explicit for the next reader.
