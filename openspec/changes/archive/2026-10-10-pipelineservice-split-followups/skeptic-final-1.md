## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `f5d1c61ce12dd2022d075d57aaaffacdba2298a8`. The base was resolved live with `resolve-review-base.sh` (exit 0): `6d298d5f83a56041188fb619bb0fd4ad333bb9ca`. The spawn-cwd guard printed `READY`. Backend only, so the UI step was skipped.

### What I verified (with evidence)

- **Main code: no behaviour change (C1).** I filtered `git diff -U0 BASE...HEAD -- backend/src/main` down to changed lines that are not comments. Exactly two remain: `private val log = LoggerFactory.getLogger(getClass)` (PipelineService class body) and `private def stepAddress(idx: Int)` (PipelineServiceSupport). The companion `log` and `PipelineService.stepAddress` are still in place (PipelineService.scala:270, :285), and every log call is unchanged. HEAD compiles; my sbt run compiled it. The javap base/post files in the run evidence dir diff empty. That proof is weak here, though: both deleted members are private, so the clean compile is what really shows nothing used them.
- **AC1, red-first proven, reproduced independently with stronger mutations than the executor's status flips:**
  - Green on HEAD, my run: `testOnly PipelineServiceCoverageGapsSpec PipelineAclSpec PipelineAnalyzeProposalRoutesSpec ExistenceNotLeakedRoutesSpec` gave exit 0, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 108` (5+23+19+61, matching test-count-evidence.md).
  - G1 with the guard deleted (`if (req.name.trim.isEmpty)` changed to `if (false)` in PipelineCreateWrites.create): both new tests went RED (`failed=2`). The service test got `Right(PipelineSummaryResponse(..., "", ...)) was not equal to Left(BadRequest("name is required")) (:111)` and the route test got `201 Created was not equal to 400 Bad Request (PipelineAclSpec.scala:403)`. So the gap was real: without the guard, a pipeline with an empty name is created.
  - G2 with the ACL bypassed (`findByIdShared(pipelineId, Some(user))` changed to `findByIdInternal(pipelineId)` in PipelineNodeReads.laneTree): the foreign-pipeline test went RED, showing `Right(Vector(PipelineLaneTreeNode(...))) was not equal to Left(NotFound(...)) (:124)`. The test therefore guards the access check, not just the status code.
  - Both mutations were restored with `git -C <wt> checkout -- backend/src/main`. `git status --short` afterwards shows only the orchestrator's untracked evaluation-1.md.
  - G3 and G4a/G4b: I read the executor's logs (`mut-g3.log`, `mut-g4a.log`, `mut-g4b.log`, each `[hel1468-guard] failed=1`) and the applied diffs (`*.mutation.txt`, one line each, at PipelineProposalAnalyze.scala:340 and PipelineStepWrites.scala:64/:129). Each assertion checks the exact `ServiceError`/status AND the message, not a bare status. For G4, a test-local `PipelineStepRepository` subclass returns `None` from `updateInternal`. design.md discloses this: it proves how the service handles `None`, not that a real race produces one. That is the branch the ticket names.
- **AC3, ExistenceNotLeakedRoutesSpec.** The diff touches only `sites` on 4 rows: PATCH/DELETE/duplicate step now point at `PipelineStepWrites.scala`, and GET analyze at `PipelineAnalyzeReads.scala`. Those methods do live there (PipelineStepWrites.scala:28/:144/:234, PipelineAnalyzeReads.scala:39). `findSummaryById`/`updateName`/`delete` remain in PipelineService.scala:94/105/123, so those three rows are correctly unchanged. No PatchSetApplyResolvers row, `patchKindExemptions` or `expectedForbiddenProducers` line appears in the diff. The `row-*.log` files each show exactly the named row FAILED (`failed=1`). The analyze mutation genuinely lets a foreign id past the gate (owner resolved via `findByIdInternal`), not just a message change that both probes would share.
- **PatchSetApplyResolvers.scala (C3).** The diff is the single :178 scaladoc comment, nothing else.
- **AC2, citations, spot-checked against the tree.** I confirmed these targets exist where cited:
  - `PipelineCreateTransaction.createTransactional`/`buildStepsAction`/`buildOutputsAction`/`validateStepCrossOwnerRefs`
  - `PipelineServiceSupport.toAnalyzeStepResponse`/`resolveSecondarySourceSchemas`
  - `PipelineAnalyzeReads.toCostVerdictResponse`
  - `PipelineProposalAnalyze.resolveInlineSourceSchema`
  - `PipelineStepCreate.persistNewStep`/`addStepReporting`
  - `PipelineCreateWrites.compensatingInlineSources`
  - `PipelineNodeReads.projectedSchemaAtNode` (the old `resolveNodeSchema` exists at base only in that comment, so it was already stale)
  - `PipelineCreatePreflight.checkStep`, which has the `PipelineStepKind.All` check at :145

  Other checks:
  - The `(:374/:818)` replacement names `PipelineCreateTransaction.createTransactional` and `PipelineRootWrites.addRoot`, the only two local `PipelineCycleRejected` catches (PipelineCreateTransaction.scala:87, PipelineRootWrites.scala:131).
  - The `trunkOf` caller repoint to `PipelineStepCreate.scala` is correct: PipelineStepWrites only references `trunkOfRoot`.
  - The D2 verification grep `PipelineService\.scala:?[0-9(]|\(:[0-9]+\)` over backend/src returns 0 hits.
  - Kept hits I sampled are still correct, e.g. `[[listRootDataSourceIdsInternalBatch]] above` (PipelineNodeReads.scala:93).
- **AC4.** Covered under C1 above.
- **AC5, D5 keep-unsplit.** The justification is honest. design.md explicitly retracts the earlier false claims (it had said each file was "one method"; the corrected member counts are listed). The case rests on: a soft guideline, an informational-only ticket item, overruns of 9-44%, and keeping byte-move proofs out of a test-and-comment PR. That is a defensible scope call, and an optional follow-up is offered.
- **AC6.**
  - `full-testfull.log` ends with `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 6662, failed 0`. It finished at 14:15; the commit is 14:16. My targeted green run on HEAD corroborates it for the touched suites. This rests on timestamps, so I note the mtime dependency; the reproduced targeted run is the self-authenticating part.
  - The new spec uses `VerifiedEmbeddedPostgres.start`.
  - No inline FQNs in the added test lines: grep for `_root_` and `com.helio.x.Y(` found none, and the spec uses imports.
  - The commit message has only the Co-Authored-By trailer. No claude.ai link or Claude-Session trailer appears in the message or the diff.
- Lane hygiene: I checked `free -g` (34 GB available) before every run. All runs used `nice -n 19 sbt -batch -J-Xmx3g testOnly`, with no server left running. The worktree is clean apart from the untracked evaluation-1.md.

### Verdict: CONFIRM

### Non-blocking notes

- The PipelineAclSpec route test's name says "creating nothing", but its body asserts only status and message. The no-row property is asserted at service level in PipelineServiceCoverageGapsSpec, so this is a naming overstatement, not a gap.
- The javap `-public` identity proof cannot see private members, so it is vacuous for these two deletions. The clean compile is the real evidence. Future dead-code tickets should not cite javap as the proof for private removals.
