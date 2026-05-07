# pipeline-create-modal Specification

## Purpose
TBD - created by archiving change create-pipeline-flow. Update Purpose after archive.
## Requirements
### Requirement: CreatePipelineModal renders three required fields
The `CreatePipelineModal` component SHALL render a modal dialog with three fields:
a pipeline name text input, a data source select populated from the existing data sources,
and an output type name text input. All three fields SHALL be required. The modal SHALL
display inline validation errors when a required field is empty on submit attempt.

#### Scenario: Modal renders all three fields
- **WHEN** `CreatePipelineModal` is open
- **THEN** a text input for pipeline name, a select for data source, and a text input for
  output type name are all visible

#### Scenario: Empty name shows validation error
- **WHEN** the user submits with an empty pipeline name
- **THEN** an inline error message is shown for the name field and the form is not submitted

#### Scenario: No data source selected shows validation error
- **WHEN** the user submits without selecting a data source
- **THEN** an inline error message is shown for the data source field and the form is not submitted

#### Scenario: Empty output type name shows validation error
- **WHEN** the user submits with an empty output type name
- **THEN** an inline error message is shown for the output type name field and the form is not submitted

### Requirement: Data source select is populated from existing data sources
The data source select in `CreatePipelineModal` SHALL be populated by dispatching `fetchDataSources`
if the data sources list is not already loaded. Each option SHALL show the data source name.

#### Scenario: Data source select shows available data sources
- **WHEN** `CreatePipelineModal` is open and data sources exist
- **THEN** the data source select contains one option per data source

#### Scenario: Data source select fetches sources if not loaded
- **WHEN** `CreatePipelineModal` is opened and the data sources status is "idle"
- **THEN** `fetchDataSources` is dispatched to load them

### Requirement: Successful submission creates the pipeline and navigates
On a valid form submission, `CreatePipelineModal` SHALL dispatch `createPipeline`,
close the modal on success, navigate to `/pipelines/:id` for the new pipeline,
and dispatch `fetchPipelines` to refresh the list.

#### Scenario: Valid submission calls POST /api/pipelines and navigates
- **WHEN** the user fills all three fields and clicks the submit button
- **THEN** `POST /api/pipelines` is called with `{ name, sourceDataSourceId, outputDataTypeName }`,
  the modal closes, and the user is navigated to `/pipelines/<newId>`

#### Scenario: Pipelines list is refreshed after creation
- **WHEN** pipeline creation succeeds
- **THEN** `fetchPipelines` is dispatched so the list reflects the new pipeline

#### Scenario: Submission error shows an error message
- **WHEN** `POST /api/pipelines` returns an error response
- **THEN** an error message is displayed in the modal and the modal remains open

