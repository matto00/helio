## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

- **`tasks.md` is a zero-byte file.**
  `stat -c '%s %y' openspec/changes/mcp-outputs-proposals-rewrite/tasks.md` → `0 2026-09-01 03:03:36`
  `md5sum` → `d41d8cd98f00b204e9800998ecf8427e` (the md5 of the empty string).
  Re-read after a 2s delay — stable, reproduced, not a flaky measurement. `wc -l` = 0, `wc -c` = 0.
  The change dir is entirely untracked (`git status --short` → `?? openspec/changes/mcp-outputs-proposals-rewrite/`),
  so there is no committed prior version to fall back on. No task content was relocated: `design.md:151`
  still forward-references "resource-scoped files/tasks (see tasks.md)", and no other artifact carries a
  task breakdown.

- **`openspec validate ... --type change` does pass** (`Change 'mcp-outputs-proposals-rewrite' is valid`).
  Confirmed the validator does not inspect `tasks.md` content, so the round-4 handoff's "validate passes"
  claim is true and simultaneously worthless as evidence that the task list exists.

- **Round-4 fix 1 (HEL-766 retargeting) — verified CORRECT against ground truth.**
  `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyRollback.scala:281-289`:
  `fullPipelineStepInverse` sets only `type`/`config`/`position`; `pipelineStepCreateRequestFromPrior`
  sets only `type`/`config`. `PipelineStepProtocol.scala:160-171` confirms both request types default
  `enabled: Option[Boolean] = None` (so the round-3 "compile error" claim was indeed false, and the
  round-4 correction is right). `domain/model/PipelineStep.scala:53` confirms `def enabled: Boolean`
  exists on the trait, so design.md decision 7's prescribed `enabled = Some(prior.enabled)` is
  type-correct. No `enabled` field exists on `Output` anywhere — the retargeting was necessary and is
  now accurate.

- **Round-4 fix 3 (refinement-chat-surface delta) — verified present.**
  `specs/refinement-chat-surface/spec.md` exists with a `## MODIFIED Requirements` block, one
  requirement and one `#### Scenario:`; `proposal.md:70` lists it under Modified Capabilities.

- **Round-4 fix 2 (HEL-670 regression test as unconditional task 5.11) — UNVERIFIABLE.**
  It was claimed to live in `tasks.md`, which is empty. This is precisely the class of claim the design
  gate exists to check, and there is nothing to check it against.

- **Everything else in the requested pass is blocked.** The tool-removal list's completeness against
  decision 10's table, the fixture-count plausibility, MCP E2E concreteness, and — explicitly — "whether
  tasks.md's sequencing (backend schema+service+MCP paired per cycle) is actually followable as written"
  all resolve against a file with no content. I cannot judge sequencing that does not exist, and I will
  not infer it from design.md's prose and call that verification.

- **Additional defect found in the same code the HEL-766 fix touches.**
  `domain/model/PipelineStep.scala:62` declares `def parentStepId: Option[PipelineStepId]` (the tree
  model landed in HEL-904, commit `2ec2a5bc`), and `CreatePipelineStepRequest` carries
  `parentStepId: Option[String] = None`. `pipelineStepCreateRequestFromPrior` drops it exactly the same
  way it drops `enabled`. Under the new Outputs tree model this is worse than the `enabled` bug: a
  rollback/recreate silently reparents the step (to root/tail), structurally corrupting the pipeline
  tree rather than just losing a boolean. The design's decision 7 fixes `enabled` and says nothing about
  `parentStepId`, which means this change would knowingly walk past a live corruption bug in the exact
  function it is editing.

### Verdict: REFUTE

`tasks.md` being empty is not a nit and not a measurement artifact — the change has no implementation
plan at all. Four prior rounds of refinement produced correct, well-grounded design prose and specs, and
then the one artifact that turns them into executable work is a zero-byte file. Executing from this state
means the executor invents the task breakdown itself, which is exactly what the design gate is for.

I recognize this is the last round in budget and that a REFUTE escalates to a human. I am not going to
soften a reproduced, binary, file-exists-or-not finding to stay inside a budget. That said, CR-1 is
mechanical and low-risk to satisfy: the design and specs are in good shape, so this is a "write the file
that was lost" fix, not another round of rethinking.

### Change Requests

1. **Write `openspec/changes/mcp-outputs-proposals-rewrite/tasks.md`.** It is currently 0 bytes. It must
   contain the resource-scoped, per-cycle task breakdown that `design.md:151` already forward-references,
   including the specific tasks the round-4 handoff claims exist and which no artifact currently carries:
   - `1.2`, `1.5`, `5.5` — the `PipelineStep.enabled` preservation work (HEL-766), targeting
     `PatchSetApplyRollback.scala`'s `fullPipelineStepInverse` and `pipelineStepCreateRequestFromPrior`.
   - `1.6` — the HEL-670 re-verification against the Outputs model.
   - `5.11` — the HEL-670 regression test, stated **unconditionally**, explicitly not gated on whether
     `1.6` reproduces the original defect live.
   Each task needs a concrete acceptance signal (which file changes, which test proves it) so the final
   gate has something to trace. Re-verify sequencing after writing: each cycle must pair backend
   schema + service + MCP so no cycle leaves the contract half-updated.

2. **Extend decision 7 (and its tasks) to cover `parentStepId`, not just `enabled`.**
   `pipelineStepCreateRequestFromPrior` (`PatchSetApplyRollback.scala:287-288`) drops
   `parentStepId: Option[PipelineStepId]` (`domain/model/PipelineStep.scala:62`) identically to how it
   drops `enabled`, and under the HEL-904 tree model that silently reparents a recreated step. Fix it in
   the same builder — `parentStepId = prior.parentStepId.map(_.value)` — and add a regression test that
   round-trips a non-root child step through rollback/recreate and asserts its parent is unchanged. Update
   `specs/patch-set-apply/spec.md` and `specs/patch-set-undo/spec.md` to state the preservation
   requirement over both fields, not `enabled` alone.

### Non-blocking notes

- `openspec validate --type change` passing while `tasks.md` is empty is a real hole in the hygiene
  gate. Worth a spinoff ticket to make the validator (or the pre-commit OpenSpec hygiene check) reject a
  change whose `tasks.md` is empty or has zero checkbox items — this failure should never have needed a
  skeptic to catch.
- Design decision 7 writes the fix as `enabled = Some(prior.enabled)` in one place and
  `enabled = prior.enabled` in the round-4 handoff summary. `Some(...)` is the correct form for both
  request types; make sure the task text uses that.
