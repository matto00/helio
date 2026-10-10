## MODIFIED Requirements

### Requirement: POST /api/pipelines creates a new pipeline with one or more roots
`POST /api/pipelines` SHALL accept `name` and `roots` (a non-empty array; each element names an existing caller-owned DataSource by `sourceId` or supplies an inline source spec), plus optional `tag`, `steps`, and `outputs`. There SHALL be no scalar `sourceDataSourceId` field: the single-source request shape is removed outright, not accepted as an alias or a legacy form.

Every root's source SHALL be ownership-checked; a root naming a non-existent or unreadable source SHALL yield 404, and a root with an empty or blank source id SHALL yield 400. An empty or absent `roots` array SHALL yield 400.

`steps`/`outputs` remain additive: absent or empty preserves the simple create (name + roots only); non-empty builds the pipeline, its roots, its steps and its Outputs in one call, any failure rolling back the whole call.

"The whole call" SHALL include every inline root source the call creates: when the response is any 4xx or 5xx, no data source created by that request SHALL remain. Failures detectable from the request alone (step type, step config, `parentStepId`, Output name/kind/config, root resolution) SHALL be rejected before any data source is created.

#### Scenario: Create with two roots returns 201 with both roots
- **WHEN** `POST /api/pipelines` is called with `name` and two `roots` naming two caller-owned sources, and no `steps`/`outputs`
- **THEN** the response is `201 Created` with the new pipeline's `id`, `name`, and a `roots` array carrying both roots in request order, each with its root id, data source id, and data source name
- **THEN** `lastRunStatus` and `lastRunAt` are absent from the response rather than null

#### Scenario: Create with one root returns 201
- **WHEN** `POST /api/pipelines` is called with a single root naming a caller-owned source
- **THEN** the response is `201 Created` and the pipeline reports a one-element `roots` array

#### Scenario: A legacy scalar sourceDataSourceId body is rejected
- **WHEN** `POST /api/pipelines` is called with a scalar `sourceDataSourceId` and no `roots`
- **THEN** the response is `400` and no pipeline is created

#### Scenario: Missing required field returns 400
- **WHEN** `POST /api/pipelines` is called with a missing or empty `name`
- **THEN** the response is `400 Bad Request` with an error message

#### Scenario: Empty roots array returns 400
- **WHEN** `POST /api/pipelines` is called with `roots: []`
- **THEN** the response is `400` and no pipeline is created

#### Scenario: A root with a blank source id returns 400
- **WHEN** `POST /api/pipelines` is called with a root whose `sourceId` is empty or whitespace
- **THEN** the response is `400` and no ownership lookup is performed for that root

#### Scenario: A root naming a non-existent or unowned source returns 404
- **WHEN** `POST /api/pipelines` is called with a root whose `sourceId` does not exist, or is owned by another user
- **THEN** the response is `404 Not Found` with an error message
- **THEN** no pipeline, root, or step is created
- **THEN** no inline source named by another root of the same request is created

#### Scenario: Created pipeline appears in GET /api/pipelines list
- **WHEN** a pipeline is created via `POST /api/pipelines`
- **THEN** a subsequent `GET /api/pipelines` includes the new pipeline in the response array

#### Scenario: Single call builds a trunk step, a tail step, and an Output
- **WHEN** `POST /api/pipelines` is called with one root, two `steps[]` entries (the second referencing the first's `clientId` as its `parentStepId`), and one `outputs[]` entry whose `nodeStepClientId` names the second step
- **THEN** the response is `201 Created` and the pipeline, its root, both steps, and the Output all exist, correctly linked

#### Scenario: Single call builds a lane under each of two roots
- **WHEN** `POST /api/pipelines` is called with two roots and one root-level step naming each root
- **THEN** each step is bound to the root it named, and neither reads the other root's frame

#### Scenario: A failing step rolls back the whole transaction
- **WHEN** `POST /api/pipelines` is called with a `steps[]` entry whose config is understood but refused, whose config cannot be decoded, or whose `parentStepId` references a `clientId` not present earlier in the same request
- **THEN** the response is a `422` (refused config) or `400` (undecodable config, unresolvable `parentStepId`) error and no pipeline, root, step, or Output row is created

#### Scenario: A failing Output rolls back the whole transaction
- **WHEN** `POST /api/pipelines` is called with valid steps but an `outputs[]` entry naming an Output kind not bindable at its `nodeStepClientId`'s node
- **THEN** the response is a `400` error and no pipeline, root, step, or Output row is created

#### Scenario: The simple-create shape runs no transactional composition
- **WHEN** `POST /api/pipelines` is called with `steps`/`outputs` both empty or absent
- **THEN** no transaction composition and no `steps`/`outputs`-related validation runs

#### Scenario: A bad step config with an inline root leaves no data source
- **WHEN** `POST /api/pipelines` is called with an inline root source and a `steps[]` entry whose config is understood but refused
- **THEN** the response is `422` naming the step's `clientId`
- **THEN** the caller owns exactly as many data sources as before the request

#### Scenario: An unknown step type with an inline root leaves no data source
- **WHEN** `POST /api/pipelines` is called with an inline root source and a `steps[]` entry whose `type` is not a known step kind
- **THEN** the response is `400` naming the invalid type
- **THEN** the caller owns exactly as many data sources as before the request

#### Scenario: A bad Output config with an inline root leaves no data source
- **WHEN** `POST /api/pipelines` is called with an inline root source and an `outputs[]` entry whose `config` carries a key not allowed for its kind
- **THEN** the response is `400`
- **THEN** the caller owns exactly as many data sources as before the request

#### Scenario: A failure only detectable after the inline source exists leaves no data source
- **WHEN** `POST /api/pipelines` is called with an inline root source and an `outputs[]` entry whose `fieldMapping` names a column absent from that source's schema
- **THEN** the response is `400`
- **THEN** the caller owns exactly as many data sources as before the request

#### Scenario: A patch-set pipeline create with a bad step type or Output config is refused before apply
- **WHEN** a patch set containing a `pipeline` `create` edit with an inline root and either an unknown step type or a disallowed Output config key is applied
- **THEN** the apply is refused with the same 4xx class as the direct route, naming the edit index
- **THEN** nothing is applied and the caller owns exactly as many data sources as before the request
- **THEN** previewing the same patch set is refused with the same 4xx class rather than returning a projection

#### Scenario: A simple-create request whose later root is unknown leaves no data source
- **WHEN** `POST /api/pipelines` is called with no `steps`/`outputs` and two roots, the first an inline source and the second naming a non-existent `sourceId`
- **THEN** the response is `404`
- **THEN** the caller owns exactly as many data sources as before the request

#### Scenario: A rolled-back patch-set pipeline create removes its inline source
- **WHEN** a patch set's `pipeline` `create` edit with an inline root applies successfully and a later edit in the same apply call fails
- **THEN** the pipeline create edit is reported rolled back
- **THEN** neither the pipeline nor the inline source it created remains
