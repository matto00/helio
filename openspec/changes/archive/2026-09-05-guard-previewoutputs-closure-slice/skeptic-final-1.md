## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of f1554b99. Every finding below is derived from source/commands I ran myself; the
evaluator's PASS was treated as a claim.

### What I verified (with evidence)

**1. Mutation sites are inside `previewOutputs`' own body (AC2).** Read the real source,
`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` (`previewOutputs`
spans ~:329-374). The three banked mutations map to real lines in that body:
- M1 → the `case Some(output) =>` call `previewAtNode(pipelineId, output.node.stepId.map(_.value), output.node.rootId.map(_.value), user)` (~:344)
- M2 → the `Future.traverse(distinctNodeKeys)` call `previewAtNode(pipelineId, stepKey, rootKey, user)` (~:361)
- M3 → the re-pair `byNodeKey((o.node.stepId.map(_.value), o.node.rootId.map(_.value)))` (~:369)
None is at `:507` (that line is inside `previewAtNode`'s `closureOf`/`backend.execute` block, which
I read separately). AC2's disqualification is respected.

**2. REDs are real, verbatim, and for a key-set mismatch.** `evidence/m1|m2|m3_evidence.txt` are
full sbt transcripts (sbt banner, `compiling 1 Scala source` — consistent with a mutated production
file — logback init, timestamps 17:49-17:51). Each failure cites `PipelineRunServiceSpec.scala:1361`
/`:1381`/`:1385`; I checked those exact lines in the committed spec and they are precisely the three
`stepRowCounts.keySet shouldBe ...` assertions. Failures are ScalaTest `Set(...) was not equal to
Set(...)` — key-set mismatches, not engine exceptions. UUIDs differ across M1/M2/M3 transcripts
(fresh fixtures per run) and M3's LHS/RHS share exactly one uuid (stepA), which is what real closure
semantics would produce — strong internal evidence these are genuine runs, not fabrications.

**3. Cross-arm GREEN controls are genuinely present and green.** I read the raw transcripts, not the
summary table: `m1_evidence.txt:39` lists the all-Outputs guard with no `*** FAILED ***`;
`m2_evidence.txt:37` lists the single-Output guard green; `m3_evidence.txt:37` likewise. Each run is
`Tests: succeeded 1, failed 1` over `tests run: 2` — arithmetically no hidden third state. The
two-axis claim therefore rests on a real discriminator (`which guard reds`), and the guards exercise
structurally distinct code (the `Some(id)` resolution arm vs. the `None` dedup/`Future.traverse`/
`byNodeKey` re-pair arm, which has no `previewStep` analogue). Notably, design.md D2a states
outright that M1 and M2 are the same transformation at two sites and that `{}` is structural on any
fixture length — the axis claim is honestly framed and narrowed rather than inflated, which is the
opposite of HEL-957's cycle-1 failure. M3 additionally supplies a non-empty wrong-value red, so the
guard set is not resting on `{}` alone.

**4. Fixture non-degeneracy is DEMONSTRATED, not asserted (AC3).** Confirmed
`InProcessPipelineEngine.scala:449` records `counts` only `if (next.enabled)`. `branchNode` is
inserted with an explicit `enabled = true` via `stepRepo.insertInternal`. The positive control is
not a claim: on my own unmutated run, the all-Outputs guard passes while asserting
`keySetByOutputId(branchOutputId) shouldBe Set(stepA.id.value, branchNode.id.value)` — i.e.
`branchNode`'s id IS count-recorded on this exact fixture. That is what makes its absence from
`targetOutput`'s key set (`Set(stepA, stepB, target)`) load-bearing rather than vacuous. Positive
control is real and working.

**5. Wrong-reason red correctly discarded (AC4).** `evidence/wrongreason_evidence.txt` shows a
`java.util.NoSuchElementException: key not found: (Some(...),None)` at `PipelineRunService.scala:369`
from the `.take(1)` mutation; mutation-evidence.md records it and explicitly does not bank it.

**6. Zero production source changed (AC/constraint).** `git diff main...HEAD --name-only | grep
backend/src/main` → no matches. The diff touches one test file plus change-doc artifacts only. No
migration.

**7. Gates re-run by me, not trusted.**
- `sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec"` → `Tests: succeeded 72,
  failed 0` / `All tests passed.` (reproduces the executor's 72/72 on unmutated source, including
  both new guards).
- `node scripts/check-scala-quality.mjs` → `clean (156 soft warning(s))`.
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.
No frontend files changed, so DESIGN.md judgment and the servers/Playwright path are not applicable
(and Playwright was correctly avoided per HEL-972).

**8. design.md's "product owner away" assumptions.** Defensible and honestly framed. All three are
labelled assumptions, each states its reversibility, and #2 (the rejected rootId axis) explicitly
says "Had the owner been available, this is the one point I would have raised; I am proceeding on
the stated reasoning rather than claiming a ruling." No ruling is claimed anywhere. The rejection
reasoning is also technically correct: I confirmed `previewAtNode` resolves the root by walking
`parentStepId` when `targetStepId` is non-empty, making a rootId-drop a genuine no-op for a
step-bound Output — so the axis is unusable for a key-set observable, not merely inconvenient.

### Verdict: CONFIRM

### Non-blocking notes
- M1 and M2 remain the same transformation at two call sites; the evidence for their distinctness is
  the cross-arm control, which is present and sound, but it is the weakest link in the package. If a
  future ticket extends these guards, an axis that reds the single-Output arm with a *non-empty wrong*
  key set (as M3 does for the all-Outputs arm) would harden the single-Output guard to M3's standard.
- `PipelineRunServiceSpec.scala` is far over the 250-line soft budget (pre-existing, flagged for many
  files by the quality check); not this ticket's problem, but the file is a future split candidate.
