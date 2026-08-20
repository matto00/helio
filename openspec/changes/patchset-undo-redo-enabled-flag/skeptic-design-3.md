## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### Context

Re-review of `tasks.md` task 2.6 and `design.md`'s "Post-review fold-in" section after the executor
reworded both in response to `skeptic-design-2.md` CR1 (the sole change request from round 2: task
2.6's original wording would have produced a needlessly duplicative new DB-backed test block instead
of a minimal, in-place extension of the pre-existing "5.3a" case). No production code is touched by
this fold-in; scope is a single test-coverage addition.

### What I verified (with evidence)

- **Read all updated planning artifacts fresh**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  under `openspec/changes/patchset-undo-redo-enabled-flag/`, plus `skeptic-design-2.md` (as the claim
  being checked, not as ground truth) — I re-derived every factual assertion below independently
  against the live worktree rather than trusting the prior report's narrative.
- **Confirmed task 2.6's new wording is the exact minimal, in-place edit CR1 asked for.**
  `tasks.md:29-37`: "Extend the EXISTING '...5.3a...' case... do NOT add a new test block... (a) on
  line 213's `seedPipelineStep(...)` call, pass `enabled = Some(false)`; (b) immediately after line
  242's existing `restoredStep` assertion, add `restoredStep.enabled shouldBe false`." This names the
  exact file, exact target case, exact line numbers, and exact code to add/change — no residual
  ambiguity that could steer an implementer toward a new, duplicative block.
- **Verified those line numbers and the surrounding code are accurate against the live file.**
  `backend/src/test/scala/com/helio/services/PatchSetUndoServiceSpec.scala:206` is the "restore
  panel/dashboard/dataSource/dataType/pipeline/pipelineStep update edits to their pre-apply state
  (5.3a)" case; line 213 is `val step = seedPipelineStep(PipelineId(pipeline.id), userA, "rename",
  JsObject(...))`; line 242 is `restoredStep.asInstanceOf[RenameStep].config.renames shouldBe
  Map("a" -> "b")`, immediately preceded by `restoredStep` being fetched via `findByIdInternal` on
  line 241. The instructed edits attach cleanly at those exact points. File is still 504 lines and
  task 2.6 is still unchecked (`[ ]`), confirming it has not yet been executed — this review is of the
  plan, not a result.
- **Verified `seedPipelineStep` already supports the instructed `enabled = Some(false)` argument.**
  `PatchSetUndoServiceSpec.scala:163-173`: `private def seedPipelineStep(..., enabled: Option[Boolean]
  = None): PipelineStepResponse = ... CreatePipelineStepRequest(kind, config, enabled = enabled) ...`
  — no helper signature change needed; the instructed one-line addition to the existing call is
  syntactically valid as written.
- **Verified `restoredStep.enabled` (no cast) is a valid expression.** `restoredStep` is typed as the
  base `PipelineStep` (returned by `pipelineStepRepo.findByIdInternal`, not the `RenameStep` subtype
  used for the `.config.renames` cast on the same line). `enabled: Boolean` is declared directly on
  the base `trait PipelineStep` (`backend/src/main/scala/com/helio/domain/PipelineStep.scala:53`), so
  `restoredStep.enabled shouldBe false` compiles without the `.asInstanceOf[RenameStep]` line 242
  needs for the kind-specific `config` field — task 2.6's instruction is technically sound, not just
  plausible-looking.
- **Confirmed the "same-shape as 2.4/5.3c" claim is real, not an unverified assertion.**
  `PatchSetUndoServiceSpec.scala:313-336`, the "restore a pipelineStep delete edit... (5.3c)" case
  (round 1's actual 2.4 execution): seeds with `enabled = Some(false)` (line 319) and asserts
  `recreated.enabled shouldBe false` (line 336) — a genuine two-point, in-place extension of a
  pre-existing case, exactly the shape task 2.6 now instructs for 5.3a.
- **Confirmed design.md now states the reasoning CR1 asked to be made explicit, not left implicit.**
  `design.md`'s "Post-review fold-in" section states: "...`PatchSetUndoServiceSpec.scala` is already
  past CONTRIBUTING.md's ~400-line 'propose a split rather than adding to it' threshold (504 lines),
  so a minimal in-place edit is the only sound choice here, not just a style preference
  (skeptic-design-2.md CR1)." This directly answers CR1's closing ask ("if a dedicated test is
  actually preferred, that reasoning should be stated explicitly... rather than left implicit") by
  affirmatively choosing the in-place edit and stating why, rather than silently picking one path.
- **Cross-artifact consistency intact.** `ticket.md`'s AC4 and `proposal.md`'s "(Fold-in, post-review)"
  bullet both describe the same DB-backed full-revert coverage, symmetric with the existing
  delete-and-recreate coverage, with no production-code claim — consistent with `tasks.md` 2.6 and
  `design.md`'s fold-in section. No contradiction across the four artifacts.
- **Re-checked for any new placeholders/ambiguity introduced by the reword.** None — the reworded task
  is more specific than the original (line numbers, exact code), not less; no `TODO`/`TBD` language;
  no new decision left open.

### Verdict: CONFIRM

The round-2 change request is fully resolved. Task 2.6 now instructs the exact minimal, in-place,
two-point edit (seed-disabled + one assertion) at named line numbers in the named pre-existing case,
matching the actual precedent (2.4/5.3c) byte-for-byte in shape, and I've independently verified both
that the instructed edit is syntactically valid against the live file (helper signature, base-trait
`enabled` field, line anchors) and that it delivers the coverage the ticket's AC4 requires without
adding to an already-over-threshold file. `design.md`'s fold-in section now states the "why minimal,
not just style" reasoning explicitly, as CR1 requested. No new issues introduced by the reword. The
plan is sound and ready for execution.

### Non-blocking notes

- None.
