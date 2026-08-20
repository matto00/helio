# HEL-705: PatchSet undo/redo silently recreates disabled pipeline steps as enabled

## Description

HEL-412 (PR matto00/helio#371) added `pipeline_steps.enabled` and threads it through the wire — but `backend/src/main/scala/com/helio/services/PatchSetUndoInverse.scala`'s `fullPipelineStepInverse` / `pipelineStepCreateRequestFromResponse` read only `type`/`config`/`position` off the raw persisted-step JSON when reconstructing a step for undo/redo. Since the wire now always carries `enabled`, a PatchSet-driven recreate (undo of a delete, or a full revert) of a DISABLED step silently comes back ENABLED — the step re-enters runs/analyze without the user asking. Self-flagged by HEL-412's executor (deliberately outside that change's scoped touch points) and endorsed for filing by its evaluator.

## Scope

- Extend the two helpers to read and propagate `enabled` (absent → true, matching the create request's contract).
- Test: a PatchSet undo that recreates a previously-disabled step restores `enabled: false`.

## Acceptance Criteria

- [ ] Undo/redo round-trips `enabled` for delete-and-recreate and full-revert paths.
- [ ] Absent `enabled` in legacy persisted JSON defaults to true (no behavior change for old records).
- [ ] Backend tests cover the disabled-step round-trip; `sbt test` clean.
- [ ] A DB-backed round-trip test (`PatchSetUndoServiceSpec.scala`) also covers the full-revert path
      (`fullPipelineStepInverse`, exercised via `restorePipelineStepUpdate`), symmetric with the
      existing DB-backed delete-and-recreate coverage — folded in post-review per delivery-time
      follow-up triage (final-gate skeptic non-blocking note, user decision 2026-08-19).

## Origin

Standalone follow-up triaged out of HEL-412 (coordinator decision: real latent correctness hole, genuinely outside that change's touched files).

## Post-review fold-in (2026-08-19)

The final-gate skeptic noted AC1's full-revert path had direct unit coverage
(`PatchSetUndoInverseSpec.scala`) but no DB-backed (5.3a-equivalent) coverage, unlike the
delete-and-recreate path's 5.3c case. Triaged (`ac_relevant=no, effort=small, overlap=high` →
`fold-in`) and approved by the user: add the DB-backed full-revert assertion before merging. Two
other non-blocking suggestions from the same review round were triaged `standalone` instead (filed as
HEL-765 and HEL-766) to keep this ticket's own scope closed.
