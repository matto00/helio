## ADDED Requirements

### Requirement: A viewer grantee is offered no edit affordance on the phone pipeline page

When the caller's role on a pipeline is `viewer`, the phone pipeline detail page SHALL render no actionable control that edits the pipeline or creates a client-only draft: no rename, no schedule chip and no schedule set/edit/pause/resume, no Add source or Edit source, no step insert/add, no step move, Disable/Enable, Duplicate or Remove (in a row menu or in the step sheet's "Step actions" menu), no editable field in the step sheet (the configuration stays readable but every field is disabled), no New output, and no Output editing. Opening a step sheet, the step preview, an Output's preview, Output history and the Runs tab stay available. A viewer SHALL NOT be able to create a client-only draft; an existing draft SHALL keep the Discard pill and the draft status, with no Save & run. Owners and editors SHALL see every edit affordance unchanged.

#### Scenario: Viewer on phone, light and dark
- **WHEN** a viewer grantee opens a shared pipeline on a phone viewport in either theme and opens a step's sheet
- **THEN** the sheet has no "Step actions" edit entry and every configuration field is disabled, and the page offers no rename, schedule chip or schedule menu item, insert or New output control

#### Scenario: Viewer cannot create a draft on phone
- **WHEN** a viewer grantee interacts with the step sheet's configuration
- **THEN** no draft status and no Discard pill appear

#### Scenario: Editor on phone keeps editing
- **WHEN** an editor grantee opens the same pipeline on a phone viewport
- **THEN** the step sheet's fields are editable and its "Step actions" menu offers the step's edit entries
