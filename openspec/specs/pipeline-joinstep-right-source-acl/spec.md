# pipeline-joinstep-right-source-acl Specification

## Purpose
TBD - created by archiving change restrict-joinstep-right-source. Update Purpose after archive.

## Requirements

### Requirement: JoinStep right-source must be caller-owned on creation
When `POST /api/pipelines/:id/steps` is called with `type: "join"`, the backend SHALL verify that
the `config.rightDataSourceId` refers to a data source owned by the authenticated caller. If the
source does not exist or is not owned by the caller, the response SHALL be `404 Not Found`
(existence-not-leaked semantics). The step SHALL NOT be persisted in this case.

An empty `rightDataSourceId` is an incomplete draft, not a referenced-but-unowned source, and SHALL
NOT trigger the ownership check or the `404` response — creation SHALL succeed with the right
source left unset, matching `pipeline-union-op`'s and `pipeline-lookup-op`'s identical carve-outs
and every other config type's `case _ => allow` fallback.

The empty value is the `defaultConfigFor("join")` seed shape defined in the frontend, reaching this
endpoint from agent/MCP and patch-set callers. Note it does NOT reach it from the op picker: `join`
is deliberately excluded from `OP_TYPES` because no `JoinConfig.tsx` editor exists, so no picker flow
can create a join step at all (see HEL-958).

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

#### Scenario: Empty rightDataSourceId join step creation succeeds
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "join"` and the
  `defaultConfigFor("join")` seed config `{"rightDataSourceId": "", "joinKey": "", "joinType": "inner"}`
- **THEN** the response is `201 Created` with the persisted step
- **THEN** no ownership lookup is performed against the empty id

### Requirement: JoinStep right-source SHALL be caller-owned on update
The backend SHALL verify `config.rightDataSourceId` ownership when `PATCH /api/pipeline-steps/:id`
is called for a `join` step and the request body contains an updated `config`. If the source does
not exist or is not owned by the authenticated caller, the response SHALL be `404 Not Found` and
the step SHALL NOT be updated.

An empty `rightDataSourceId` SHALL NOT trigger the ownership check or the `404` response on this
path either, for the same reason as on creation — the update SHALL succeed with the right source
left unset.

#### Scenario: Cross-user right-source update returns 404
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own join step with
  `config.rightDataSourceId` set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** the step's persisted config is unchanged

#### Scenario: Own-source right-source update succeeds
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own join step with
  `config.rightDataSourceId` set to a data source owned by user A
- **THEN** the response is `200 OK` with the updated step config

#### Scenario: Empty rightDataSourceId update succeeds (source cleared or never chosen)
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own join step with
  `config.rightDataSourceId` set to `""`
- **THEN** the response is `200 OK` with the updated step config
- **THEN** no ownership lookup is performed against the empty id

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
