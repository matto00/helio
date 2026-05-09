## ADDED Requirements

### Requirement: Pipeline detail page shows loading state while fetching
`PipelineDetailPage` SHALL display a loading indicator while `fetchPipelineById` or
`fetchPipelineSteps` is in the `"loading"` state. The main content SHALL not be rendered
until data is available.

#### Scenario: Spinner visible during fetch
- **WHEN** `PipelineDetailPage` is mounted and the API call is pending
- **THEN** a loading indicator is visible and the pipeline content is not rendered

### Requirement: Pipeline detail page shows error state on fetch failure
`PipelineDetailPage` SHALL display an error message when `fetchPipelineById` fails,
rather than rendering the editor.

#### Scenario: Error message shown on pipeline load failure
- **WHEN** `fetchPipelineById` rejects
- **THEN** an error message is shown instead of the editor

### Requirement: Pipeline name is loaded from Redux state
`PipelineDetailPage` SHALL use `currentPipeline.name` from Redux (populated via `fetchPipelineById`)
as the initial value for the output name field, replacing the previous fallback to the URL id.

#### Scenario: Output name initialized from API response
- **WHEN** `fetchPipelineById` succeeds
- **THEN** the output name field is initialized with `currentPipeline.name`
