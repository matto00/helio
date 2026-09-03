## MODIFIED Requirements

### Requirement: Union step second-source reference must be caller-owned on creation and update
The backend SHALL verify that a `union` step's `config.otherDataSourceId` refers to a data source
owned by the authenticated caller, on both `POST /api/pipelines/:id/steps` (creation) and
`PATCH /api/pipeline-steps/:id` (update), mirroring the check HEL-278 already added for
`JoinConfig.rightDataSourceId`. If the source does not exist or is not owned by the caller, the
response SHALL be `404 Not Found` (existence-not-leaked semantics) and the step SHALL NOT be
persisted/updated. An empty `otherDataSourceId` (the "+ Add transformation step" picker's own
default seed value — `defaultConfigFor("union")`) is an incomplete draft, not a referenced-but-
unowned source, and SHALL NOT trigger the ownership check or the `404` response — creation/update
SHALL succeed with the second source left unset, matching `pipeline-lookup-op`'s identical
`referenceDataSourceId` behavior and every other config type's `case _ => allow` fallback.

#### Scenario: Cross-user union step creation returns 404
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "union"` and
  `config.otherDataSourceId` set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** no step row is inserted into `pipeline_steps`

#### Scenario: Own-source union step creation succeeds
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "union"` and
  `config.otherDataSourceId` set to a data source owned by user A
- **THEN** the response is `201 Created` with the persisted step

#### Scenario: Cross-user union step update returns 404
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own union step with
  `config.otherDataSourceId` set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** the step's persisted config is unchanged

#### Scenario: Empty otherDataSourceId union step creation succeeds (picker default)
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "union"` and
  `config.otherDataSourceId` set to `""` (the picker's default seed value)
- **THEN** the response is `201 Created` with the persisted step
- **THEN** no ownership check is attempted against the empty id

#### Scenario: Update to empty otherDataSourceId succeeds
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own union step with
  `config.otherDataSourceId` set to `""`
- **THEN** the response is `200 OK` with the step's `otherDataSourceId` persisted as empty
