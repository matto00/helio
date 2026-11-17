## MODIFIED Requirements

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

## ADDED Requirements

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
