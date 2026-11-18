## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Step edits form a client-only draft
On the pipeline detail page (desktop and phone), editing a step's config, toggling a step's enabled flag or deleting a step SHALL change only a client-side draft overlaid on the saved pipeline; nothing SHALL be written to the server until Save & run. A draft exists exactly when the draft differs from the saved pipeline (its steps or its Outputs). Deleting a step in the draft SHALL follow the server's delete semantics: the first child by position takes the deleted step's place, every other child and its subtree is removed, and Outputs on removed steps are removed. While a draft exists, adding, inserting and duplicating a step, adding a lane step and reordering a trunk SHALL also change only the draft (see "Step structure actions inside a draft"), and so SHALL creating, editing and deleting an Output, instantiating a shape and adding an Output as a tail with aggregate (see "Output actions inside a draft" and "Shapes and the aggregate tail inside a draft"). While a draft exists, adding and removing a source (a root) SHALL change only the draft too (see "Add and remove source are draft actions"). Leaving the page with a draft SHALL ask for confirmation when the leave can be held (a reload, a tab close, a click on an in-app link); a leave that cannot be held (browser Back or Forward, the command palette, Settings) SHALL NOT lose the draft: it is kept for the tab together with the saved steps and Outputs it was made against and re-applied when the pipeline page is opened again; if the saved pipeline changed meanwhile the draft is restored but treated as stale (the stale-base notice with only "Reload the saved pipeline", Save & run refused until then), never saved over the change. Kept drafts are removed on logout.

#### Scenario: Edit creates a draft
- **WHEN** a user changes a filter step's threshold
- **THEN** the page shows "Draft · unsaved changes" and no request is sent to `/api/pipeline-steps/*`

#### Scenario: Edit back to the saved value
- **WHEN** a user changes a value and then changes it back to the saved value, with no other edits
- **THEN** no draft exists and the header shows Dry run and Run again

#### Scenario: Structural actions stay available during a draft
- **WHEN** a draft exists
- **THEN** add source, remove source (except the last remaining source), add, insert, duplicate, "+ lane", reorder, "+ Output", opening an Output, "Add output" on a step, "Add Outputs from a shape" and "Add as tail with aggregate" are enabled; on a not-yet-created AI step "+ lane", duplicate, "Add output" and "Add as tail with aggregate" stay disabled with that reason
