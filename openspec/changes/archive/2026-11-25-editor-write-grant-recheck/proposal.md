## Why

HEL-1707 re-checks the editor grant inside root, draft-save, step and Output-delete writes. Four other pipeline-side
writes an editor can reach still trust a check made earlier, in a separate step: Output create, the backfill that runs
after an Output create or update, Output PATCH, and insight refresh. A grant revoked or downgraded in between does not
stop them. Output PATCH also has a gap outside any race: a creator downgraded to viewer can still edit their Output.

## What Changes

- Output create re-checks, inside its transaction and right after the existing pipeline-row lock, that the caller is
  still the pipeline owner or an `editor`. A refusal writes nothing and answers what the route's own check answers
  (`403` for a remaining viewer grant, the existing not-found `404` for no grant).
- The Output backfill (after create or update) re-checks the acting user's owner-or-editor access before it evaluates
  and inside the snapshot write's transaction. A refused backfill writes nothing. It is fire-and-forget, so no response
  changes.
- **Visible change outside the race:** `PATCH /api/outputs/:id` requires the caller to be the Output's creator AND the
  pipeline owner or a current `editor` (HEL-1707's R2 rule for delete). A creator downgraded to viewer, or revoked,
  gets the `404 Output not found` a viewer or stranger already gets, and nothing is written. Patch-set forward apply and
  rollback of an Output update go through the same write and get the same rule.
- A manual or pin insight refresh re-checks the requester's owner-or-editor access when the render starts, before any
  attempt row, quota charge or model call. A refused render writes no row and charges nothing. The `202` is unchanged.

## Non-goals

- Dashboard-editor writes (panel PATCH/delete/duplicate/batch, dashboard contents/PATCH/auto-layout, form submit):
  follow-up HEL-1889.
- Scheduler-triggered and run-triggered insight renders (they act for no user). A render already sent to the model
  keeps its row.
- `FOR SHARE` on grant rows, new locks, new statuses, API shape changes, migrations.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-editor-grant-recheck`: Output create and the Output backfill re-check access inside the write.
- `output-routes-api`: `PATCH /api/outputs/:id` requires current owner-or-editor access on the pipeline.
- `insight-render-triggers`: a manual or pin refresh re-checks the requester's access at render start.

## Impact

- Backend only: `OutputRepository` (`insertInternal`, `updateOwned`), `OutputService`, `PipelineRunBackfill`,
  `NodeSnapshotRepository` call site, `PatchSetUndoRestorers.restoreBoundOutputs`, `InsightRenderService`. Reuses
  HEL-1707's `PipelineWriteAccess` and `PipelineWriteRefusal`.
