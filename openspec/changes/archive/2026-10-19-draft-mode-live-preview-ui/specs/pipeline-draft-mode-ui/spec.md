## ADDED Requirements

### Requirement: Step edits form a client-only draft
On the pipeline detail page (desktop and phone), editing a step's config, toggling a step's enabled flag or deleting a step SHALL change only a client-side draft overlaid on the saved pipeline; nothing SHALL be written to the server until Save & run. A draft exists exactly when the draft differs from the saved pipeline. Deleting a step in the draft SHALL follow the server's delete semantics: the first child by position takes the deleted step's place, every other child and its subtree is removed, and Outputs on removed steps are removed. While a draft exists, structural operations the draft does not carry (adding, inserting or duplicating a step, reordering, lane and root changes, shape instantiation, and Output create, edit and delete) SHALL be disabled with the reason "Save or discard your draft first". Leaving the page with a draft SHALL ask for confirmation when the leave can be held (a reload, a tab close, a click on an in-app link); a leave that cannot be held (browser Back or Forward, the command palette, Settings) SHALL NOT lose the draft: it is kept for the tab together with the saved steps it was made against and re-applied when the pipeline page is opened again; if the saved pipeline changed meanwhile the draft is restored but treated as stale (the stale-base notice with only "Reload the saved pipeline", Save & run refused until then), never saved over the change. Kept drafts are removed on logout.

#### Scenario: Edit creates a draft
- **WHEN** a user changes a filter step's threshold
- **THEN** the page shows "Draft · unsaved changes" and no request is sent to `/api/pipeline-steps/*`

#### Scenario: Edit back to the saved value
- **WHEN** a user changes a value and then changes it back to the saved value, with no other edits
- **THEN** no draft exists and the header shows Dry run and Run again

#### Scenario: Structural action blocked during a draft
- **WHEN** a draft exists and the user opens a step's actions
- **THEN** add, duplicate and reorder actions are disabled and state "Save or discard your draft first"

### Requirement: Client-evaluable edits recompute locally with no request
Per-step rows, counts and schema SHALL be computed in the browser from the cached source samples by the client evaluator, recomputed from the edited step down. Editing a client-evaluable step SHALL send no network request of any kind (no step PATCH, no analyze, no preview), and SHALL update the spine counts and the preview table within 50 ms per edit. A step's spine count SHALL show the draft count, and "saved → draft" (for example "104 → 92") when they differ. The preview table SHALL show the selected step's draft rows and a live/updating/stale state; the live indicator SHALL not use the accent.

#### Scenario: Burst of edits
- **WHEN** a user makes ten edits in a row to a filter step over a sampled source
- **THEN** zero requests are sent during the burst, each edit updates the spine count and preview within 50 ms, and the step's count reads "<saved> → <draft>"

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
