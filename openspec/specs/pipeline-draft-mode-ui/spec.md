# pipeline-draft-mode-ui Specification

## Purpose
Defines draft mode on the pipeline detail page: step edits, enabled toggles and deletes change only a client-side draft with live per-step counts and preview, until the user Discards it or commits it atomically with Save & run.

## Requirements

### Requirement: Step edits form a client-only draft
On the pipeline detail page (desktop and phone), editing a step's config, toggling a step's enabled flag or deleting a step SHALL change only a client-side draft overlaid on the saved pipeline; nothing SHALL be written to the server until Save & run. A draft exists exactly when the draft differs from the saved pipeline (its steps or its Outputs). Deleting a step in the draft SHALL follow the server's delete semantics: the first child by position takes the deleted step's place, every other child and its subtree is removed, and Outputs on removed steps are removed. While a draft exists, adding, inserting and duplicating a step, adding a lane step and reordering a trunk SHALL also change only the draft (see "Step structure actions inside a draft"), and so SHALL creating, editing and deleting an Output, instantiating a shape and adding an Output as a tail with aggregate (see "Output actions inside a draft" and "Shapes and the aggregate tail inside a draft"). While a draft exists, root add and remove SHALL be disabled with the reason "Save or discard your draft first". Leaving the page with a draft SHALL ask for confirmation when the leave can be held (a reload, a tab close, a click on an in-app link); a leave that cannot be held (browser Back or Forward, the command palette, Settings) SHALL NOT lose the draft: it is kept for the tab together with the saved steps and Outputs it was made against and re-applied when the pipeline page is opened again; if the saved pipeline changed meanwhile the draft is restored but treated as stale (the stale-base notice with only "Reload the saved pipeline", Save & run refused until then), never saved over the change. Kept drafts are removed on logout.

#### Scenario: Edit creates a draft
- **WHEN** a user changes a filter step's threshold
- **THEN** the page shows "Draft · unsaved changes" and no request is sent to `/api/pipeline-steps/*`

#### Scenario: Edit back to the saved value
- **WHEN** a user changes a value and then changes it back to the saved value, with no other edits
- **THEN** no draft exists and the header shows Dry run and Run again

#### Scenario: Structural action blocked during a draft
- **WHEN** a draft exists
- **THEN** add source and remove source are disabled and state "Save or discard your draft first", while add, insert, duplicate, "+ lane", reorder, "+ Output", opening an Output, "Add output" on a step, "Add Outputs from a shape" and "Add as tail with aggregate" are enabled; on a not-yet-created AI step "+ lane", duplicate, "Add output" and "Add as tail with aggregate" stay disabled with that reason

### Requirement: Client-evaluable edits recompute locally with no request
Per-step rows, counts and schema SHALL be computed in the browser from the cached source samples by the client evaluator, recomputed from the edited step down. Editing a client-evaluable step SHALL send no network request of any kind (no step PATCH, no analyze, no preview), and SHALL update the spine counts and the preview table the first edit after load within 100 ms (cold first execution) and every later edit within 50 ms (owner ruling `relax-cold-first-edit`). A step's spine count SHALL show the draft count, and "saved → draft" (for example "104 → 92") when they differ. The preview table SHALL show the selected step's draft rows and a live/updating/stale state; the live indicator SHALL not use the accent.

#### Scenario: Burst of edits
- **WHEN** a user makes ten edits in a row to a filter step over a sampled source
- **THEN** zero requests are sent during the burst, the first edit updates the spine count and preview within 100 ms (cold first execution) and each later edit within 50 ms, and the step's count reads "<saved> → <draft>"

### Requirement: Changed rows flash once
When the selected step's preview rows change because of an edit, rows that were not in that step's previous frame SHALL be highlighted: a brief tint fading over the motion system's highlight duration under the Full and Subtle motion settings, and a static tint until the next change under Off or an OS reduced-motion preference. Selecting a different step SHALL not highlight rows.

#### Scenario: Reduced motion
- **WHEN** motion is set to Off and an edit changes the preview rows
- **THEN** the changed rows show a static highlight and no animation runs

### Requirement: Per-step status in the draft
Each step SHALL show one status: ok, error, pending (needs the server, request in flight or queued), stale, or "not previewed (AI step): runs on Save & run". A step in error SHALL show its message, and every step downstream of it SHALL keep its last good frame, marked stale. AI steps and everything downstream SHALL never be previewed before Save & run.

#### Scenario: Error freezes downstream
- **WHEN** a compute step's expression is made invalid
- **THEN** that step shows an error and the steps after it keep their previous counts and rows, marked stale

#### Scenario: AI step
- **WHEN** a pipeline contains an AI step
- **THEN** that step and every step downstream show "not previewed (AI step): runs on Save & run" and no request is sent for them

### Requirement: Server-only steps use the draft-preview transport
While a draft exists, steps the client cannot evaluate SHALL be computed through `POST /api/pipelines/:id/draft-preview`, debounced and single-flight, honouring its `429` with `Retry-After`, never exceeding the draft-preview limiter, and never calling a run endpoint. While a request is in flight or queued the affected steps SHALL show pending with their previous frame visible and marked stale. With no draft, no draft-preview request SHALL be sent.

#### Scenario: Server-only edit
- **WHEN** a user edits a step of a server-only kind repeatedly for three seconds
- **THEN** the step shows pending, then its server-computed count; the number of draft-preview requests stays within the scheduler's pacing bound and no run request is sent

### Requirement: Discard restores the saved pipeline exactly
Discard SHALL drop the draft and show the saved pipeline exactly (steps, configs, order, enabled flags, Output config and fingerprint deep-equal to the state before the first edit), and SHALL send no request of its own. A step preview that was never loaded (its step was first opened while the draft existed) is fetched when that step is shown, as for any step first opened (owner ruling `amend-ac-fetch-on-view`).

#### Scenario: Discard
- **WHEN** a user edits two steps, deletes a third and presses Discard
- **THEN** the page shows the saved pipeline exactly, Discard itself sends no request (a step first opened during the draft fetches its one saved preview on view, and nothing else is sent), and a fresh read of the pipeline definition has the same fingerprint as before the edits

### Requirement: Save & run persists the draft atomically and starts a run
Save & run SHALL read the saved definition once and, if the draft's base still matches it, send one `POST /api/pipelines/:id/draft/save` with the final step tree, every surviving Output and `runAfterSave: "run"`. On success the page SHALL show the saved pipeline, clear the draft, show the run's status, and offer Undo of that save. A save SHALL write one history (journal) row. If the run was refused after the save committed, the page SHALL say "Saved. Run not started: rate limit, retry in N s" (N omitted when unknown) with a Run now action. A validation failure SHALL keep the draft and name the failing step when the server names it.

#### Scenario: Save and run
- **WHEN** a user with a draft presses Save & run
- **THEN** exactly one draft save request is sent, the run starts, the draft indicator disappears, and Undo restores the prior definition

#### Scenario: Run refused by the run guard
- **WHEN** the save commits but the run is refused with a retry-after of 12 seconds
- **THEN** the page says "Saved. Run not started: rate limit, retry in 12 s" and offers Run now

### Requirement: Stale base offers only reload
When the saved pipeline changed since the draft's base (a `409` from the save, or a mismatch found before sending), the page SHALL show that the pipeline changed and offer only "Reload the saved pipeline"; there SHALL be no overwrite action. Reloading SHALL replace the base with the current saved pipeline and re-apply the draft's edits to the steps that still exist, reporting how many edits no longer apply.

#### Scenario: Concurrent edit
- **WHEN** another session changes the pipeline after this page loaded and the user presses Save & run
- **THEN** the page offers only "Reload the saved pipeline", and after reloading the user's edits are still in the draft

### Requirement: Deleting steps asks for cascade confirmation
When a save would remove steps, Outputs, bound panels or alert rules (a `422` with the impact), the page SHALL list them and save only after the user confirms; cancelling SHALL keep the draft.

#### Scenario: Delete a step with a bound Output
- **WHEN** a draft deletes a step whose Output is bound to a panel and the user presses Save & run
- **THEN** a confirmation lists the step, the Output and the panel, and the save happens only on confirm

### Requirement: Undo refusal names its blockers
When Undo of a draft save is refused with `409` because the save removed something bound to panels or alert rules, the page SHALL show the refusal naming those panels and alert rules and SHALL leave the saved pipeline unchanged.

#### Scenario: Undo blocked
- **WHEN** the user undoes a save that deleted a step whose Output had a bound panel
- **THEN** the page shows the 409 naming that panel and the pipeline is unchanged

### Requirement: Sample label and age on the page
Every source on the pipeline page SHALL show its sample label; every non-static source SHALL show the sample's capture age, and owners and editors SHALL have the manual refresh.

#### Scenario: REST source
- **WHEN** a pipeline over a REST source is opened
- **THEN** the source shows its sample label with its age and a refresh control

### Requirement: Kept drafts end with the session
Kept pipeline drafts SHALL be removed from the tab whenever the app treats the session as ended: an explicit logout,
an API call returning `401` because the session expired, or a page load whose session check fails.

#### Scenario: Session expires while a draft is kept
- **WHEN** a kept draft exists for a pipeline and an API call returns `401` (not an `/api/auth/me` or `/api/auth/mfa` call)
- **THEN** no kept draft remains in the tab's storage, and the next user who signs in does not see it

#### Scenario: Session expired before a reload
- **WHEN** a kept draft exists, the session expires, and the tab is reloaded
- **THEN** the kept draft is removed when the load's session check fails, before anyone signs in again

### Requirement: Draft frames survive a layout switch
Crossing the phone boundary (768px) while a draft exists SHALL keep each client-evaluated step's last good draft
frame, including while a step is in error, so the new layout shows the same counts and rows without waiting for a new
walk. A server-resolved step MAY request its draft preview again after the switch.

#### Scenario: Desktop to phone mid-error
- **WHEN** a draft puts a step in error on desktop, and the viewport then narrows to 375px
- **THEN** the phone layout shows the draft's last good counts and rows for the client-evaluated steps above and at the error, not the saved counts and not a pending state

### Requirement: A restored step is not a created step
A step that reappears because the draft was discarded (or a kept draft was restored) SHALL NOT be treated as newly
created: selection and the phone step sheet SHALL NOT jump to it.

#### Scenario: Discard restores a deleted step
- **WHEN** a draft deletes a saved step and the user discards the draft
- **THEN** the step reappears in the spine and the selected step does not change to it

### Requirement: Draft notices take only their own height
On desktop, a draft notice (stale base, save error) SHALL occupy only its own height in the page; the step body SHALL
start directly below it with no empty band, and the 1280×800 no-document-scroll requirement SHALL still hold.

#### Scenario: Save error notice at 1280
- **WHEN** a draft save is refused with a notice at 1280×800
- **THEN** the gap between the notice's bottom edge and the step body's top edge is at most the page's normal row gap

### Requirement: The run refresh requests only Outputs that still exist
When a run finishes, the page SHALL refresh the previews of the Outputs in the pipeline's current definition only; an
Output removed by the save that started the run SHALL NOT be requested.

#### Scenario: Save & run removes an Output
- **WHEN** a draft deletes a step with an Output, the user confirms the cascade, and the run then succeeds
- **THEN** no request is made for the removed Output and the console shows no 404

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
A kept draft SHALL carry the structure actions, the Output actions and the edits. A draft kept in either earlier format (config edits, enabled toggles and deletes only; or step structure actions without Output actions) SHALL still restore. A kept draft whose saved base (steps or Outputs) changed SHALL be restored as stale, and "Reload the saved pipeline" SHALL keep every action whose ids still exist and report how many were dropped.

#### Scenario: Restore after Back
- **WHEN** a draft inserts a step and creates an Output on it, the user leaves with browser Back and opens the pipeline again
- **THEN** the inserted step and the new Output are shown and the draft notice is present

#### Scenario: Earlier-format kept draft
- **WHEN** the tab holds a kept draft in the earlier format that deletes step 2
- **THEN** opening the pipeline restores the draft with step 2 deleted

#### Scenario: Step-structure-format kept draft
- **WHEN** the tab holds a kept draft in the step-structure format (no Output actions) that inserts a step
- **THEN** opening the pipeline restores the draft with the inserted step and no Output change, not stale

### Requirement: Output actions inside a draft
While a draft exists, creating an Output (on a saved step, on a step that is new in the draft, or on a root), editing an Output's name or config, and deleting an Output SHALL change only the draft: it SHALL send no write request to any Output or step endpoint and no request reading a stored resource by an id that exists only in the draft (reads of saved data, such as a saved Output's History, and the server's analysis of the unsaved draft, stay allowed). An edit SHALL produce the config today's edit produces on the server (the stored config with the edited keys replaced, a cleared key stored as null). Deleting a saved Output SHALL keep the editor's two-click confirmation ("Confirm delete (removes from N dashboards)"); at Save & run the cascade confirmation SHALL list the Output, the panels bound to it and its alert rules, and confirming SHALL remove them exactly as today's immediate delete does. Deleting an Output created in the draft SHALL remove it with no cascade confirmation. An Output on a step the draft removes SHALL be removed with that step. The spine's Outputs section and the Live Output column SHALL show the draft's Outputs, a created Output rendered from its node's draft rows. With no draft open, each action SHALL keep its immediate behavior.

#### Scenario: Create an Output on a new step
- **WHEN** a draft inserts a filter step and the user creates a table Output on it
- **THEN** the Output is listed and rendered in the Live Output column from the draft rows, no Output or step write is sent, and Save & run sends one `draft/save` whose Output carries a `clientId` and a `nodeStepClientId`

#### Scenario: Edit an Output in a draft
- **WHEN** a draft exists and the user renames an Output and changes its chart type
- **THEN** no `PATCH /api/outputs/*` is sent, and after Save & run and a reload the Output has the new name and chart type and its other config keys unchanged

#### Scenario: Delete an Output bound to a panel
- **WHEN** a draft exists and the user deletes an Output bound to one panel with the two-click confirmation, then presses Save & run
- **THEN** the cascade confirmation lists the Output and 1 panel, and after "Remove and save" the Output and the panel are gone

#### Scenario: Create then delete
- **WHEN** the only draft change is an Output created in the draft, and the user deletes it
- **THEN** no draft exists

#### Scenario: Pipeline source target with several sources
- **WHEN** a draft exists on a pipeline with two sources and the user opens "+ Output"
- **THEN** the "Pipeline source" target is disabled with "Pick a step: this pipeline has several sources" and the Output cannot be added until a step is picked

#### Scenario: Discard drops draft Outputs
- **WHEN** a draft creates, edits and deletes Outputs and the user discards it
- **THEN** the saved Outputs are shown exactly and no request is sent

### Requirement: Draft-aware Output editor
While a draft exists, the Output editor SHALL take its columns, its per-kind binding eligibility and its preview from the draft at its node, never from the saved definition: the columns and their types SHALL be the server's projection of the DRAFT at that node (for every step, the server's analysis of the unsaved draft definition, which stores nothing; for the pipeline source, the saved pipeline's), and the eligibility SHALL equal what the server computes for those columns. When that projection cannot be obtained, a kind with a numeric or time-ordered slot SHALL NOT be savable from the editor (it states "Column types could not be checked; Save & run the draft first"), while kinds without such slots stay savable. Changing the target step in the editor SHALL move its columns and preview to that step.  With no draft open the editor SHALL behave as today.

#### Scenario: Columns of a new step
- **WHEN** a draft inserts a compute step adding column `total`, and the user opens "Add output" on it
- **THEN** the field picker lists `total`, the preview shows the draft rows, and no request names the new step's draft id

#### Scenario: A draft cast changes the offered columns
- **WHEN** a draft adds a cast of `date` to timestamp and the user opens "Add output" below it
- **THEN** `date` is offered for a timeline's time slot

#### Scenario: Typed columns at a new step
- **WHEN** a draft inserts a filter step under a source with a timestamp column and the user opens "Add output" on it
- **THEN** the timestamp column is offered for a timeline's time slot, as the server offers it for the saved source

### Requirement: Shapes and the aggregate tail inside a draft
While a draft exists, "Add Outputs from a shape" SHALL add the shape's steps and Outputs to the draft in one action, placed as the immediate instantiation places them (a chain of steps after the anchor, which take over the anchor's children, then the Outputs on them), and "Add as tail with aggregate" SHALL add an aggregate step as a new child of its node after the existing children plus the Output on it, in one action. Neither SHALL write anything until Save & run; Discard SHALL drop all of it. With no draft open, each SHALL keep its immediate behavior.

#### Scenario: Shape in a draft
- **WHEN** a draft exists and the user applies a shape whose expansion has two steps
- **THEN** the spine shows both steps, no step or Output write is sent, and after Save & run and a reload the saved pipeline has them in the same places

#### Scenario: Shape expansion carrying an Output
- **WHEN** a draft exists and a shape expansion returns steps and an Output on one of them
- **THEN** the Output is created in the draft on the new step it names and Save & run sends it with that step's client id

#### Scenario: Aggregate tail in a draft
- **WHEN** a draft exists and the user creates a chart Output with "Add as tail with aggregate"
- **THEN** an aggregate lane step and the Output on it are in the draft, and Save & run saves both in one request

### Requirement: Add and remove source are draft actions
While a draft exists, "Add source" (desktop spine and the phone actions menu) and "Remove source" on a source card SHALL
be enabled and SHALL change only the draft. A drafted source SHALL appear in the source list with the draft styling, its
sample SHALL feed the draft preview, and steps and Outputs SHALL be addable on it. A drafted removal SHALL hide the
source, its steps and its Outputs from the draft view. Save & run SHALL apply them atomically with the rest of the draft,
confirming the removal cascade first; Discard SHALL drop them. The kept draft SHALL restore them after a reload, and the
stale-base "Reload the saved pipeline" path SHALL count a root op it cannot re-apply as dropped. Removing the last
remaining source SHALL stay unavailable.

#### Scenario: Add a source inside a draft and save
- **WHEN** a user with a draft adds a source, adds a step on it, and clicks Save & run
- **THEN** one save request carries both, and after it the saved pipeline shows the new source and step

#### Scenario: Discard drops a drafted source
- **WHEN** a user adds a source inside a draft and clicks Discard
- **THEN** the source list is back to the saved roots and no request changed the pipeline

#### Scenario: Kept draft restores a drafted removal
- **WHEN** a user removes a source inside a draft and reloads the page
- **THEN** the restored draft still hides that source and Save & run removes it
