## ADDED Requirements

### Requirement: A write response's auto-run denial reasons are neutral for a writer who is not the pipeline's owner
When a dataset write response (row append, row replace, row update, or form submit, including a form's file-field submission) reports a downstream pipeline whose auto-run was denied, each reason's `code` and `stepId` SHALL be returned unchanged. For a writer who owns the denied pipeline, each reason's `detail` SHALL be the full estimator detail. For a writer who does not own the denied pipeline (any grantee), each estimator reason's `detail` SHALL be the same fixed neutral sentence the pipeline analyze response gives a non-owner for that code (a generic neutral sentence for a code with none), so the response carries no row count, step count, threshold, source kind, op name or quoted identifier. A `step-config-invalid` reason's `detail` SHALL be returned unchanged to every writer. The response shape SHALL NOT change.

#### Scenario: An editor's form submit refused for size carries no figure
- **WHEN** a dashboard editor who holds a grant on a downstream pipeline submits a form whose write denies that pipeline's auto-run with reason `rows-above-threshold`
- **THEN** the submit response's `deniedPipelines` entry carries code `rows-above-threshold` with the neutral detail, and no digit of the estimated row count or the threshold appears in any reason's detail

#### Scenario: The pipeline owner's own write keeps the full reason
- **WHEN** the pipeline's owner writes to the dataset and the auto-run is denied with reason `rows-above-threshold`
- **THEN** the response's reason detail names the estimated row count and the threshold, as before

#### Scenario: A step-config-invalid reason reaches a grantee unchanged
- **WHEN** a grantee's write denies a pipeline because an enabled step's configuration is invalid
- **THEN** the `step-config-invalid` reason's detail is the same text the owner would receive
