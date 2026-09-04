## REMOVED Requirements

### Requirement: POST /api/pipelines creates a new pipeline
**Reason:** the request shape changes from a scalar `sourceDataSourceId` to a non-empty `roots[]` array, so several of
this requirement's scenarios ("Non-existent sourceDataSourceId returns 404", "The pre-existing simple-create shape is
unaffected") describe a field that no longer exists. Per decision 11 the single-source shape is removed outright rather
than kept as an alias, so the requirement is replaced wholesale rather than edited scenario-by-scenario — carrying its
scenarios forward unchanged would leave a merged spec asserting a request field that 400s.

**Replaced by:** "POST /api/pipelines creates a new pipeline with one or more roots" below.

## ADDED Requirements

### Requirement: POST /api/pipelines creates a new pipeline with one or more roots
`POST /api/pipelines` SHALL accept `name` and `roots` (a non-empty array; each element names an existing caller-owned DataSource by `sourceId` or supplies an inline source spec), plus optional `tag`, `steps`, and `outputs`. There SHALL be no scalar `sourceDataSourceId` field: the single-source request shape is removed outright, not accepted as an alias or a legacy form.

Every root's source SHALL be ownership-checked; a root naming a non-existent or unreadable source SHALL yield 404, and a root with an empty or blank source id SHALL yield 400. An empty or absent `roots` array SHALL yield 400.

`steps`/`outputs` remain additive: absent or empty preserves the simple create (name + roots only); non-empty builds the pipeline, its roots, its steps and its Outputs in one call, any failure rolling back the whole call.

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
- **WHEN** `POST /api/pipelines` is called with a `steps[]` entry whose config fails validation, or whose `parentStepId` references a `clientId` not present earlier in the same request
- **THEN** the response is a `400` error and no pipeline, root, step, or Output row is created

#### Scenario: A failing Output rolls back the whole transaction
- **WHEN** `POST /api/pipelines` is called with valid steps but an `outputs[]` entry naming an Output kind not bindable at its `nodeStepClientId`'s node
- **THEN** the response is a `400` error and no pipeline, root, step, or Output row is created

#### Scenario: The simple-create shape runs no transactional composition
- **WHEN** `POST /api/pipelines` is called with `steps`/`outputs` both empty or absent
- **THEN** no transaction composition and no `steps`/`outputs`-related validation runs
