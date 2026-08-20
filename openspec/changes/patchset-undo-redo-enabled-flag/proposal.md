## Why

HEL-412 added `pipeline_steps.enabled` and threads it through the create/update wire, but
`PatchSetUndoInverse.scala`'s `fullPipelineStepInverse`/`pipelineStepCreateRequestFromResponse` only
read `type`/`config`/`position` off the persisted step JSON. A PatchSet undo/redo that recreates or
fully reverts a step (delete-and-recreate, or a full revert of an update) silently comes back
`enabled: true` even if the captured state was disabled — the step re-enters runs/analyze without the
user asking. This is a defect against `patch-set-undo`'s existing requirement that undo restores every
touched resource to its exact pre-apply state; no new behavior is being introduced.

## What Changes

- `fullPipelineStepInverse` reads `enabled` off the persisted step JSON and propagates it as an
  explicit `Some(...)` on the full-overwrite `UpdatePipelineStepRequest` (never left `None`/"no
  change" — matches design.md D5's full-overwrite discipline already applied to `type`/`config`/
  `position`). Absent key (legacy persisted JSON predating HEL-412) defaults to `true`.
- `pipelineStepCreateRequestFromResponse` reads `enabled` off the persisted step JSON and passes it
  through as `Option[Boolean]` on `CreatePipelineStepRequest`, matching that request's own
  absent-means-`true` contract.
- Backend test coverage: a PatchSet undo that recreates (delete-undo) or fully reverts (update-undo) a
  previously-disabled step restores `enabled: false`; an absent `enabled` key on legacy JSON restores
  `enabled: true`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `patch-set-undo`: adds an explicit scenario to the existing "every touched resource restored to its
  pre-apply state" requirement, naming the pipeline-step `enabled` field specifically (previously
  covered only implicitly by the general "every resource... restored" language, which the current
  code violates for this one field).

## Impact

- `backend/src/main/scala/com/helio/services/PatchSetUndoInverse.scala` — the two named helpers.
- New/extended test coverage in `backend/src/test/scala/com/helio/services/PatchSetUndoInverseSpec.scala`
  (and/or `PatchSetUndoServiceSpec.scala` for the end-to-end DB-backed path).
- No wire/schema changes — `enabled` already exists on `CreatePipelineStepRequest`/
  `UpdatePipelineStepRequest`/`PipelineStepResponse` since HEL-412.

## Non-goals

- `PatchSetApplyRollback.scala`'s own `fullPipelineStepInverse`/`pipelineStepCreateRequestFromPrior`
  (the WITHIN-A-SINGLE-APPLY-CALL rollback/compensation path, distinct from this ticket's
  cross-call undo/redo journal) appear to have the same gap, reading a domain `PipelineStep` without
  its `enabled` field. Out of scope here — the ticket names only `PatchSetUndoInverse.scala`'s two
  helpers. Flagged for a follow-up triage at delivery, mirroring how this ticket itself was born from
  HEL-412's self-flagged out-of-scope finding.
