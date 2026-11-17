## MODIFIED Requirements

### Requirement: Step edits form a client-only draft
On the pipeline detail page (desktop and phone), editing a step's config, toggling a step's enabled flag or deleting a step SHALL change only a client-side draft overlaid on the saved pipeline; nothing SHALL be written to the server until Save & run. A draft exists exactly when the draft differs from the saved pipeline. Deleting a step in the draft SHALL follow the server's delete semantics: the first child by position takes the deleted step's place, every other child and its subtree is removed, and Outputs on removed steps are removed. While a draft exists, adding, inserting and duplicating a step, adding a lane step and reordering a trunk SHALL also change only the draft (see "Step structure actions inside a draft"). While a draft exists, structural operations the draft does not carry (root add and remove, shape instantiation, and Output create, edit and delete, including adding an Output through a step) SHALL be disabled with the reason "Save or discard your draft first". Leaving the page with a draft SHALL ask for confirmation when the leave can be held (a reload, a tab close, a click on an in-app link); a leave that cannot be held (browser Back or Forward, the command palette, Settings) SHALL NOT lose the draft: it is kept for the tab together with the saved steps it was made against and re-applied when the pipeline page is opened again; if the saved pipeline changed meanwhile the draft is restored but treated as stale (the stale-base notice with only "Reload the saved pipeline", Save & run refused until then), never saved over the change. Kept drafts are removed on logout.

#### Scenario: Edit creates a draft
- **WHEN** a user changes a filter step's threshold
- **THEN** the page shows "Draft · unsaved changes" and no request is sent to `/api/pipeline-steps/*`

#### Scenario: Edit back to the saved value
- **WHEN** a user changes a value and then changes it back to the saved value, with no other edits
- **THEN** no draft exists and the header shows Dry run and Run again

#### Scenario: Structural action blocked during a draft
- **WHEN** a draft exists
- **THEN** add source, remove source, shape instantiation and add Output are disabled and state "Save or discard your draft first", while add, insert, duplicate, "+ lane" and reorder are enabled

## ADDED Requirements

### Requirement: Step structure actions inside a draft
While a draft exists, add step (append), insert step, duplicate step, "+ lane" and trunk reorder (Move up, Move down and, on desktop, drag) SHALL change only the draft and SHALL send no request to any step, analyze or preview endpoint. Each action SHALL produce in the draft the same step tree its immediate version produces on the server: insert places the new step directly after its anchor and moves the anchor's children under it; "+ lane" adds a new child of the anchor after its existing children; duplicate inserts a copy (kind, config, enabled) directly after the original; reorder permutes the trunk of one root. These actions SHALL work on new steps as well as saved ones, and deleting a new step SHALL follow the same delete semantics as a saved step. If the saved pipeline changes under the draft, a draft action whose steps no longer exist SHALL be dropped whole, never partially applied, and the page SHALL report how many draft changes could not be applied; Save & run SHALL send nothing rather than a reduced tree when its replay over the freshly read saved pipeline drops a change. A not-yet-created AI step is never part of a recorded draft action: a reorder records the trunk without it, an insert next to it anchors on the nearest saved or new step, and "+ lane" and duplicate on it are disabled during a draft with "Save or discard your draft first". A new step SHALL be evaluated by the client evaluator (or the draft-preview transport for a server-only step) and SHALL show its draft count with no saved count. With no draft open, each action SHALL keep its immediate behavior.

#### Scenario: Insert inside a draft
- **WHEN** a draft exists and the user inserts a filter step after step 1
- **THEN** the spine shows the new step after step 1 with a draft count, and no request is sent to `/api/pipeline-steps/*` or `/api/pipelines/<id>/steps*`

#### Scenario: Reorder back to the saved order
- **WHEN** the only draft change is a Move down, and the user then moves the same step up again
- **THEN** no draft exists

#### Scenario: Add then delete
- **WHEN** the only draft change is a step inserted after a step that has no child other than its trunk continuation, and the user deletes that inserted step
- **THEN** no draft exists

#### Scenario: Delete a new step that took over a tail
- **WHEN** a draft inserts a step after a step that also has a "+ lane" tail, and the user deletes the inserted step
- **THEN** the tail is removed from the draft as the server's delete would remove it, the draft still exists, and Save & run asks for cascade confirmation naming the tail

#### Scenario: Reorder past a pending AI step
- **WHEN** a draft exists, the trunk shows a not-yet-created AI step, and the user moves a saved trunk step down
- **THEN** the move is shown, and after Save & run the saved trunk has the moved order without the AI step

#### Scenario: Saved pipeline changes under a reorder
- **WHEN** a draft holds a trunk reorder and the saved trunk of that root gains or loses a step before the draft is saved
- **THEN** the reorder is dropped whole (never partially applied), the page reports how many draft changes could not be applied, and every parent keeps at most one trunk child

### Requirement: Save & run persists new and moved steps atomically
Save & run SHALL send the draft's final tree in one `POST /api/pipelines/:id/draft/save`: a new step carries a `clientId` (and `parentClientId` when its parent is new), never an `id`, and moved steps carry their final parent and position. After the save, the saved pipeline SHALL have exactly the structure the draft showed. If the selected step was new, the selection (and the `?step=` URL parameter) SHALL stay on the saved step that came from it. Undo of such a save SHALL restore the prior structure atomically, with the selection on a step that still exists. Discard SHALL drop every new step and restore the saved order with no request.

#### Scenario: Save a draft with a duplicate
- **WHEN** a draft duplicates step 2 and the user presses Save & run
- **THEN** one `draft/save` request carries a step with a `clientId` and step 2's config, and after a reload the saved pipeline shows the copy directly after step 2

#### Scenario: Undo a structural save
- **WHEN** a draft inserts a step and moves a trunk step down, the user presses Save & run, and then Undo
- **THEN** the saved pipeline has the structure it had before the draft, and the selected step is one that still exists

#### Scenario: Discard a draft with a lane step
- **WHEN** a draft adds a "+ lane" step and the user discards the draft
- **THEN** the lane step is gone, the saved pipeline is shown exactly, and no request is sent

### Requirement: Kept drafts carry structure actions and old drafts still restore
A kept draft SHALL carry the structure actions with the edits. A draft kept in the earlier format (config edits, enabled toggles and deletes only) SHALL still restore. A kept draft with a new step whose saved base changed SHALL be restored as stale, and "Reload the saved pipeline" SHALL keep every action whose anchor still exists and report how many were dropped.

#### Scenario: Restore after Back
- **WHEN** a draft inserts a step, the user leaves with browser Back and opens the pipeline again
- **THEN** the inserted step is shown and the draft notice is present

#### Scenario: Earlier-format kept draft
- **WHEN** the tab holds a kept draft in the earlier format that deletes step 2
- **THEN** opening the pipeline restores the draft with step 2 deleted
