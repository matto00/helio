## MODIFIED Requirements

### Requirement: Save action persists the pipeline name
`PipelineDetailPage` SHALL render a Save button that dispatches `updatePipeline` with the current
(possibly edited) name. On success it SHALL navigate to `/pipelines`.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the Save control is a secondary "Save pipeline" button in the header (shown while the name is dirty), with the same behaviour.

#### Scenario: Save navigates to pipeline list on success
- **WHEN** the user clicks Save and `PATCH /api/pipelines/:id` succeeds
- **THEN** the user is navigated to `/pipelines`

#### Scenario: Save shows error on failure
- **WHEN** the user clicks Save and `PATCH /api/pipelines/:id` fails
- **THEN** an error message is displayed and navigation does not occur

#### Scenario: Desktop save
- **WHEN** the user edits the name in the desktop header and activates "Save pipeline"
- **THEN** the new name is persisted

### Requirement: Cancel action with confirmation on dirty state
When the form is dirty, clicking Cancel SHALL show a confirmation prompt. If the user confirms,
all local changes SHALL be discarded and the user SHALL be navigated to `/pipelines`.
If the user cancels the prompt, the form SHALL remain open with its current state.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the Cancel control and its inline discard confirmation ("Discard unsaved changes" with "Discard changes" and "Keep editing") live in the header, with the same behaviour.

#### Scenario: Dirty cancel navigates away after confirmation
- **WHEN** the user has unsaved changes and clicks Cancel, then confirms the prompt
- **THEN** the user is navigated to `/pipelines`

#### Scenario: Dirty cancel stays on page when prompt is dismissed
- **WHEN** the user has unsaved changes and clicks Cancel, then dismisses the prompt
- **THEN** the user remains on the pipeline detail page with changes intact

#### Scenario: Desktop discard confirmation
- **WHEN** the user cancels with unsaved name changes in the desktop header
- **THEN** an inline confirmation asks before discarding and Keep editing leaves the changes in place
