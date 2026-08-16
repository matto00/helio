# pipeline-step-preview Delta Specification

## MODIFIED Requirements

### Requirement: StepCard Preview button fetches and renders sample rows
The frontend StepCard component SHALL:
- When the preview is active (expanded card with the preview open), call
  `GET /api/pipelines/:id/steps/:stepId/preview` and render the sample rows (up to 10) in the
  shared `DataGrid` preview variant below the config editor, inside the expanded step card body
- Render the step's output schema (column name + type) alongside the sample rows, sourced
  client-side from the analyze endpoint's per-step `outputSchema` (no new backend call)
- Omit the schema display (rows still render) when analyze data for the step is unavailable
- Show a loading indicator while the preview request is in flight
- On error, show an inline error message
- Toggling the preview control SHALL hide the preview (toggle behavior)
- Persist the open/closed preview preference per user (localStorage), so a user who left the
  preview open gets an auto-opened preview on subsequently expanded step cards
- Re-fetch the preview rows automatically, debounced, after the step's persisted config changes
  **or the step's position in the editor's step list changes (reorder)** while the preview is
  active — without requiring a manual close/reopen or a full pipeline run

#### Scenario: Preview shows sample rows and output schema together
- **WHEN** the user activates the preview on an expanded StepCard for a pipeline with static data
  and analyze data is available for that step
- **THEN** a table of up to 10 rows appears below the config editor together with the step's
  output schema listing each column name and type

#### Scenario: Schema display is omitted when analyze data is unavailable
- **WHEN** the preview is active but the analyze result has no entry for the step (pending,
  failed, or unknown step id)
- **THEN** the sample rows render without a schema display and no error is shown for the
  missing schema

#### Scenario: Preview refreshes after a config edit settles
- **WHEN** the preview is active and the user edits the step's config such that a PATCH persists
  a new config
- **THEN** the preview rows re-fetch automatically after a debounce interval, without the user
  toggling the preview or running the pipeline

#### Scenario: Preview refreshes after a reorder
- **WHEN** the preview is active on a step and the step's position in the step list changes via
  a reorder
- **THEN** the preview rows re-fetch automatically after a debounce interval, reflecting the
  step's new upstream prefix

#### Scenario: Closed preview does not refresh on config edits
- **WHEN** the preview is closed and the user edits the step's config
- **THEN** no preview request is issued

#### Scenario: Preview open state persists as a user preference
- **WHEN** the user opens the preview on one step card and later expands another step card (or
  reloads the editor)
- **THEN** the preview auto-opens on the newly expanded card, and after the user hides the
  preview, subsequently expanded cards default to closed

#### Scenario: Preview loading state is shown
- **WHEN** the preview request is in flight
- **THEN** a "Loading preview..." text is shown in place of the table

#### Scenario: Preview error state is shown
- **WHEN** the preview request fails (e.g. network error or 422)
- **THEN** an inline error message is shown instead of the table

#### Scenario: Second toggle hides the preview
- **WHEN** the preview is visible and the user toggles the preview control again
- **THEN** the preview is hidden and the control reflects the collapsed state
