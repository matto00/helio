# panel-creation-shape-step Specification

## Purpose
Lets a user instantiate a smart pipeline shape directly from panel creation — filling the shape's
params, then instantiating and running it — so a data-bound panel can be bound to a fresh, purpose-built
DataType without first visiting the Pipelines page.
## Requirements
### Requirement: Shape instantiation step for data-bound panel creation
Choosing a shape on the datatype-select step SHALL advance the modal to a shape-instantiate step
collecting: a required pipeline name, a required output type name (identical validation to
`CreatePipelineModal`'s own `outputDataTypeName` field), a required data source (from the caller's own
data sources), and the selected shape's params form (rendered via the shared `ShapeParamsFields`
component, one widget per `paramsSchema` entry's `dataType`, per the existing pipeline-editor "start
from a shape" convention).

#### Scenario: Selecting a shape opens the instantiate step
- **WHEN** the user is on the datatype-select step for a metric panel and selects the `single-row`
  shape card
- **THEN** the shape-instantiate step is shown with a pipeline-name field, an output-type-name field, a
  data-source picker, and the `single-row` shape's params form
- **AND** the name-entry step is not yet shown

#### Scenario: Submit is disabled until required fields are filled
- **WHEN** the shape-instantiate step is shown
- **AND** the pipeline name is empty, or the output type name is empty, or no data source is selected,
  or a required shape param is empty
- **THEN** the submit button is disabled

### Requirement: Submitting instantiates and runs the shape, binding on success only
Submitting the shape-instantiate step SHALL, in order: call `POST /api/pipeline-shapes/:id/expand`;
on success, call `POST /api/pipelines` with the entered name, source, and output type name; on success,
call `POST /api/pipeline-steps` once per expanded step, in order; on success, call
`POST /api/pipelines/:id/run`. Only once `run` succeeds SHALL the modal set the panel's `dataTypeId` to
the created pipeline's `outputDataTypeId` and advance to the name-entry step. No step of this chain
SHALL be retried automatically or partially skipped.

#### Scenario: Full chain success advances to name-entry and binds the DataType
- **WHEN** the user fills the shape-instantiate step and submits
- **AND** expand, create-pipeline, every add-step call, and run all succeed
- **THEN** the name-entry step is shown
- **AND** the panel's selected DataType is the newly created pipeline's output DataType

#### Scenario: A failed expand shows the shape's own message and creates nothing
- **WHEN** the user submits the shape-instantiate step
- **AND** `POST /api/pipeline-shapes/:id/expand` responds 422
- **THEN** the shape-instantiate step remains shown
- **AND** the 422 response's message is displayed inline, verbatim
- **AND** no pipeline is created

#### Scenario: A failed pipeline or step creation shows an inline error and creates no panel binding
- **WHEN** the user submits the shape-instantiate step
- **AND** expand succeeds but `POST /api/pipelines` or a `POST /api/pipeline-steps` call fails
- **THEN** the shape-instantiate step remains shown with an inline, non-silent error
- **AND** the panel's `dataTypeId` is not set
- **AND** no automatic retry or rollback of already-created resources occurs

#### Scenario: A failed run offers retry without redoing prior stages
- **WHEN** the pipeline and all steps were created successfully but
  `POST /api/pipelines/:id/run` fails
- **THEN** an inline, non-silent error is shown with a "Retry run" action
- **AND** activating "Retry run" re-submits only the run call for the already-created pipeline

### Requirement: Binding sets dataTypeId only, matching existing DataType-select behavior
On a successful instantiate-and-run chain, the modal SHALL set only the panel's `dataTypeId` to the
created output DataType — `fieldMapping` SHALL remain unset, identical to selecting an existing DataType
via the datatype-select step.

#### Scenario: fieldMapping is not populated after shape instantiation
- **WHEN** the shape-instantiate chain completes successfully
- **THEN** the panel creation payload's `fieldMapping` is absent, the same as the existing
  DataType-select path

