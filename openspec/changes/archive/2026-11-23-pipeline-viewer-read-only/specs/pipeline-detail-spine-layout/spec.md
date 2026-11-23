## ADDED Requirements

### Requirement: A viewer grantee is offered no edit affordance on the desktop pipeline page

When the caller's role on a pipeline is `viewer`, the desktop pipeline detail page SHALL render no actionable control that edits the pipeline or creates a client-only draft: no rename (name button or menu item), no schedule chip and no schedule set/edit/pause/resume, no Edit source, no Add source, no step insert/add, no step move, drag or reorder, no step Disable/Enable, Duplicate or Remove, no step-actions menu entry that edits, no editable step configuration field (the configuration stays readable but every field is disabled), no New output, and no Output editing (opening an Output shows its preview with no editable field, no Save and no Delete). Read-only entries stay: selecting a step, the step preview table, opening an Output's preview, Output history and Run history. A viewer SHALL NOT be able to create a client-only draft by any path; a draft that already exists (for example one restored after a role change) SHALL be shown with Discard and without Save & run. Owners and editors SHALL see every edit affordance unchanged. While the caller's role is not yet known (`pending`), edit affordances SHALL NOT be offered; an owner is never `pending`.

#### Scenario: Viewer on desktop, light and dark
- **WHEN** a viewer grantee opens a shared pipeline on a desktop viewport in either theme and selects a step
- **THEN** no rename, schedule chip or schedule menu item, Add source, insert, move, Disable, Duplicate, Remove or New output control is present, every step configuration field is disabled, and no draft status or Discard is shown

#### Scenario: Viewer cannot create a draft
- **WHEN** a viewer grantee interacts with the selected step's configuration on desktop
- **THEN** the page shows no draft (no "Discard draft", no draft chip) and no draft is kept for the tab

#### Scenario: Viewer opens an Output
- **WHEN** a viewer grantee opens an Output
- **THEN** its preview is shown with no editable field and no Save or Delete button

#### Scenario: Viewer with an existing draft keeps Discard
- **WHEN** a viewer grantee opens a pipeline for which a draft is already kept in the tab
- **THEN** Discard is offered, Save & run is not, and discarding shows the saved pipeline

#### Scenario: Editor on desktop keeps editing
- **WHEN** an editor grantee opens the same pipeline
- **THEN** rename, schedule, insert, step actions, New output and editable step fields are present and an edit creates a draft
