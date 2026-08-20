## 1. Backend

- [x] 1.1 In `backend/src/main/scala/com/helio/services/PatchSetUndoInverse.scala`,
      `fullPipelineStepInverse(json)`: extract `enabled` from the persisted step JSON
      (`fields.get("enabled").map(_.convertTo[Boolean]).getOrElse(true)`) and pass it as an explicit
      `Some(...)` on the returned `UpdatePipelineStepRequest` (never `None` — this is a full-overwrite
      inverse, design.md D6).
- [x] 1.2 In the same file, `pipelineStepCreateRequestFromResponse(json)`: extract `enabled` from the
      persisted step JSON as `fields.get("enabled").map(_.convertTo[Boolean])` and pass it through on
      the returned `CreatePipelineStepRequest` (design.md D7 — `None` already means "created enabled"
      per that request's own contract, so no explicit default needed here).

## 2. Tests

- [x] 2.1 In `backend/src/test/scala/com/helio/services/PatchSetUndoInverseSpec.scala`, add a
      `PatchSetUndoInverse.fullPipelineStepInverse` block: a captured step JSON with `"enabled":
      false` restores `enabled = Some(false)` on the returned `UpdatePipelineStepRequest`.
- [x] 2.2 Same block: a captured step JSON with no `"enabled"` key at all (legacy, pre-HEL-412)
      restores `enabled = Some(true)`.
- [x] 2.3 Add a `PatchSetUndoInverse.pipelineStepCreateRequestFromResponse` block: a captured step
      JSON with `"enabled": false` returns `enabled = Some(false)` on the `CreatePipelineStepRequest`;
      a captured step JSON with no `"enabled"` key returns `enabled = None`.
- [x] 2.4 Check whether `backend/src/test/scala/com/helio/services/PatchSetUndoServiceSpec.scala`
      already exercises a real DB-backed pipeline-step delete-and-recreate or full-revert undo path;
      if so, extend the closest existing case to disable the step before capture and assert the
      restored step's `enabled` field — otherwise this task is a no-op (unit coverage in 2.1-2.3 is
      sufficient; do not add a new DB-backed test class solely for this).
- [x] 2.5 `sbt test` clean (full backend suite, not just the touched spec files).
- [x] 2.6 (Fold-in, post-review; skeptic-design-2.md CR1) Extend the EXISTING "restore
      panel/dashboard/dataSource/dataType/pipeline/pipelineStep update edits to their pre-apply state
      (5.3a)" case in `PatchSetUndoServiceSpec.scala` (line ~206) — do NOT add a new test block. This
      case already exercises the full-revert path (`fullPipelineStepInverse`, via
      `restorePipelineStepUpdate`) for the `pipelineStep` `update` edit; it just doesn't yet assert
      `enabled`. Two-line, same-shape edit as 2.4's 5.3c extension: (a) on line 213's
      `seedPipelineStep(...)` call, pass `enabled = Some(false)`; (b) immediately after line 242's
      existing `restoredStep` assertion, add `restoredStep.enabled shouldBe false`. `sbt test` clean
      afterward.
