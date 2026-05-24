## ADDED Requirements

### Requirement: JoinStep right-source must be caller-owned on creation
When `POST /api/pipelines/:id/steps` is called with `type: "join"`, the backend SHALL verify that
the `config.rightDataSourceId` refers to a data source owned by the authenticated caller. If the
source does not exist or is not owned by the caller, the response SHALL be `404 Not Found`
(existence-not-leaked semantics). The step SHALL NOT be persisted in this case.

#### Scenario: Cross-user join step creation returns 404
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "join"` and
  `config.rightDataSourceId` set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** no step row is inserted into `pipeline_steps`

#### Scenario: Own-source join step creation succeeds
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "join"` and
  `config.rightDataSourceId` set to a data source owned by user A
- **THEN** the response is `201 Created` with the persisted step
- **THEN** subsequent pipeline evaluation resolves the right source and produces join output

#### Scenario: Non-existent right-source returns 404
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "join"` and
  `config.rightDataSourceId` set to an ID that does not exist in `data_sources`
- **THEN** the response is `404 Not Found`

### Requirement: JoinStep right-source SHALL be caller-owned on update
The backend SHALL verify `config.rightDataSourceId` ownership when `PATCH /api/pipeline-steps/:id`
is called for a `join` step and the request body contains an updated `config`. If the source does
not exist or is not owned by the authenticated caller, the response SHALL be `404 Not Found` and
the step SHALL NOT be updated.

#### Scenario: Cross-user right-source update returns 404
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own join step with
  `config.rightDataSourceId` set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** the step's persisted config is unchanged

#### Scenario: Own-source right-source update succeeds
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own join step with
  `config.rightDataSourceId` set to a data source owned by user A
- **THEN** the response is `200 OK` with the updated step config

### Requirement: Existing join steps evaluate regardless of right-source accessibility
The runtime pipeline evaluation engine SHALL continue to use the privileged (unscoped) data source
lookup when resolving the right-side source during `JoinStep.evaluate` and Spark batch execution.
This ensures that steps that were valid at authoring time continue to function; if the right source
has been deleted, the engine raises a clear "DataSource not found" error rather than silently
returning empty results.

#### Scenario: Pipeline with a valid join step evaluates successfully
- **WHEN** a pipeline owner runs a pipeline that includes a join step whose right-source they own
- **THEN** the engine resolves the right source and returns joined rows

#### Scenario: Pipeline with a deleted right-source fails with a clear error
- **WHEN** the right-source of a join step is deleted after the step was created, and the pipeline
  owner triggers a run
- **THEN** the run fails with an error message indicating the data source was not found
- **THEN** no silent data loss or empty-row substitution occurs
