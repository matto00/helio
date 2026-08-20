## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### Context

Re-review of a small post-review fold-in onto an already-archived, PR-opened change
(https://github.com/matto00/helio/pull/405). Scope: task 2.6 in `tasks.md` adds a DB-backed
`PatchSetUndoServiceSpec.scala` case for the full-revert path (`fullPipelineStepInverse`, via
`restorePipelineStepUpdate`), symmetric with the existing 2.4/5.3c delete-and-recreate DB-backed
coverage. No production code change is planned.

### What I verified (with evidence)

- **Read all four updated planning artifacts in full**: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, plus the change-scoped `specs/patch-set-undo/spec.md` delta, under
  `openspec/changes/patchset-undo-redo-enabled-flag/`.
- **Read both prior review rounds as claims, not facts, then independently re-derived them**:
  `skeptic-design-1.md`, `skeptic-final-1.md`, `evaluation-1.md`.
- **Confirmed the fold-in's stated premise against the actual diff already on `HEAD`.** `git log
  --oneline main..HEAD` shows one production commit (`bcc05772`, "HEL-705 Restore captured enabled
  flag on PatchSet pipeline-step undo/redo") plus an archive commit. `git diff 1e2e3a86 bcc05772 --
  backend/src/test/scala/com/helio/services/PatchSetUndoServiceSpec.scala` shows the round-1 2.4 work
  did NOT add a new test case for the delete-and-recreate DB-backed path — it minimally extended the
  **pre-existing** "restore a pipelineStep delete edit... (5.3c)" case (from HEL-413) by adding
  `enabled = Some(false)` to the `seedPipelineStep` call and one assertion line
  (`recreated.enabled shouldBe false`). This is the actual precedent design.md's fold-in section
  claims to mirror ("same pattern as the existing 5.3c case").
- **Confirmed a directly analogous pre-existing case already covers the full-revert path task 2.6
  targets.** `PatchSetUndoServiceSpec.scala:206-243`, "restore panel/dashboard/dataSource/dataType/
  pipeline/pipelineStep update edits to their pre-apply state (5.3a)": seeds a pipeline + step (line
  213), applies a `pipelineStep` `update` edit that changes `config` only (line 226-227,
  `UpdatePipelineStepRequest(None, Some(...), None)` — `enabled` defaults to `None`, i.e. unchanged
  forward), undoes it (which calls `restorePipelineStepUpdate` → `fullPipelineStepInverse`, per
  `PatchSetUndoService.scala:244-286`, already confirmed in round 1's `skeptic-design-1.md`), and
  fetches the restored step (line 241) but currently only asserts its `config`, not `enabled`.
  Round 1's own `skeptic-design-1.md` (lines 63-70) already identified this exact case ("line 200")
  as the pre-existing DB-backed full-revert coverage point.
- **Compared this against task 2.6's literal instruction.** `tasks.md:29-33` reads: "Add a DB-backed
  `PatchSetUndoServiceSpec.scala` case for the full-revert path... seed a step `enabled = false`,
  apply an `update` edit that changes some other field, undo it, and assert the restored step is
  still `enabled = false`." Unlike task 2.4 (which explicitly said "check whether... already
  exercises... if so, extend the closest existing case"), task 2.6 gives no instruction to check for
  or reuse the existing 5.3a case — it describes building the seed/edit/undo/assert flow from
  scratch, which is exactly what 5.3a already does. A competent implementer following 2.6 literally
  would write a brand-new, self-contained test block duplicating 5.3a's scaffolding (seed source,
  seed pipeline, seed step, build edit, apply, undo, fetch, assert) for the sole purpose of adding
  one field to one existing assertion path — where the minimal, actually-symmetric-with-5.3c edit is
  two lines: `enabled = Some(false)` on line 213's `seedPipelineStep` call, plus
  `restoredStep.enabled shouldBe false` after line 242.
- **Checked this against the binding file-size rule, not just a style preference.**
  `CONTRIBUTING.md:24`: "Prefer small, composable units over large files or functions... If a file
  you're editing crosses ~400 lines, propose a split in the PR description rather than adding to it."
  `wc -l backend/src/test/scala/com/helio/services/PatchSetUndoServiceSpec.scala` → 504 lines,
  already well past that 400-line threshold (evaluation-1.md's own non-blocking note already flagged
  it at 505 post-round-1, up from 492 pre-round-1). Task 2.6 as literally worded instructs adding a
  new, non-minimal test block to a file already over CONTRIBUTING.md's stated threshold for "don't
  add, propose a split instead," when a two-line extension of the already-present, already-exercising
  5.3a case delivers the identical regression coverage the new AC/task requires.
- **Confirmed the spec delta needs no further change for this fold-in.**
  `specs/patch-set-undo/spec.md`'s "Restoring a pipeline step preserves its captured enabled/disabled
  state" scenario already generically covers "whether by recreating a deleted step or by fully
  reverting an updated one" — no wording update needed regardless of which test-authoring approach
  2.6 ends up using.
- **AC/task traceability otherwise intact.** The new ticket.md AC4, proposal.md's added bullet,
  design.md's "Post-review fold-in" section, and tasks.md's 2.6 are all mutually consistent in intent
  (DB-backed full-revert coverage, no production change) — the only gap is task 2.6's operational
  wording not steering the implementer toward the minimal, already-precedented extension its own
  design.md section claims to be following.

### Verdict: REFUTE

The fold-in's *intent* is sound and correctly scoped (pure test addition, no design decision, no
production change) — but `tasks.md` task 2.6 is worded in a way that will foreseeably produce a
needlessly duplicative new test case in a file design.md's own fold-in section says should follow
"the same pattern as the existing 5.3c case" (i.e., a minimal, in-place extension), and that
duplication would add to a test file already past CONTRIBUTING.md's "propose a split rather than
adding to it" threshold. This is cheap to fix now and expensive to catch again at the final gate.

### Change Requests

1. **`tasks.md` task 2.6** — reword to explicitly instruct extending the existing 5.3a case rather
   than adding a new one, mirroring how 2.4 was actually executed against 5.3c (per
   `git diff 1e2e3a86 bcc05772 -- backend/.../PatchSetUndoServiceSpec.scala`). Concretely: in the
   "restore panel/dashboard/dataSource/dataType/pipeline/pipelineStep update edits to their pre-apply
   state (5.3a)" case (`PatchSetUndoServiceSpec.scala:206`), change line 213's `seedPipelineStep` call
   to pass `enabled = Some(false)`, and add `restoredStep.enabled shouldBe false` immediately after
   line 242's existing `restoredStep` assertion. This is the same-shape edit 2.4 made to 5.3c
   (seed-disabled + one assertion line), delivers identical regression coverage for
   `restorePipelineStepUpdate`/`fullPipelineStepInverse`, and avoids adding a new, non-minimal block
   to a file already over CONTRIBUTING.md's 400-line "propose a split" threshold (504 lines currently).
   If there is a concrete reason a dedicated, standalone test is actually preferred here (e.g. wanting
   5.3a to stay a pure "one assertion per kind" test), that reasoning should be stated explicitly in
   design.md's fold-in section rather than left implicit — right now design.md asserts the "same
   pattern as 5.3c" framing while tasks.md's wording doesn't operationalize it that way.

### Non-blocking notes

- None beyond the above — the rest of the fold-in (ticket.md AC4, proposal.md bullet, design.md
  section, spec.md delta) is sound and requires no further changes.
