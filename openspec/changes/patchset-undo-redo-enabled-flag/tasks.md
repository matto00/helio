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
