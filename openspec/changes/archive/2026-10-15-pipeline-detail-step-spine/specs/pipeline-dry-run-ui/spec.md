## MODIFIED Requirements

### Requirement: Pipeline detail page exposes a "Dry run" button
The pipeline detail page footer SHALL include a "Dry run" secondary button rendered to the left
of the existing "Run pipeline" button. Clicking it SHALL dispatch `submitPipelineRun` with
`dryRun: true`. The button SHALL be disabled while `runStatus` is `"queued"` or `"running"`.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the "Dry run" button is a secondary button in the header, beside the primary Run, with the same behaviour and the "Dry run" accessible name.

#### Scenario: Dry run button is visible on pipeline detail page
- **WHEN** the user navigates to a pipeline detail page
- **THEN** a button labelled "Dry run" is visible in the footer alongside the "Run pipeline" button

#### Scenario: Clicking "Dry run" dispatches run with dryRun flag
- **WHEN** the user clicks the "Dry run" button
- **THEN** `submitPipelineRun` is dispatched with `{ pipelineId: id, dryRun: true }`

#### Scenario: Dry run button disabled during active run
- **WHEN** `runStatus` is `"queued"` or `"running"`
- **THEN** the "Dry run" button is disabled

#### Scenario: Desktop dry run button
- **WHEN** the desktop pipeline detail page is rendered
- **THEN** a secondary "Dry run" button is present in the header and starts a dry run
