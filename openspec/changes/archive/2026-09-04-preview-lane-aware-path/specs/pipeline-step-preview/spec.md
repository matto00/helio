## MODIFIED Requirements

### Requirement: GET /api/pipelines/:id/steps/:stepId/preview returns sample rows up to a step
The backend SHALL expose `GET /api/pipelines/:id/steps/:stepId/preview`. The endpoint SHALL:
- Fetch all steps for the pipeline in the repository's execution order
- Find the step with `id == stepId`
- Build the target step's **transitive dependency closure**: the target, every ancestor reachable by `parentStepId`,
  and — for every `join`/`union`/`lookup` step already in the closure whose `secondaryInput` is `{kind:"lane", stepId}` —
  that referenced node together with its own ancestors, repeated to a fixed point. The closure SHALL NOT be a
  positional prefix `0..K`, which folds unrelated lanes in and omits referenced ones
- Execute that closure against the pipeline's root DataSource(s) using the in-process engine, leaving evaluation
  ORDER to the engine's own topological walk rather than imposing a second ordering
- Return the first 10 rows of the target node's own frame as `{ rows: [...], rowCount: N }` where `rowCount` is
  the total number of rows produced (not capped at 10)
- Pass the pipeline's FULL set of roots to the engine, never narrowed to the target's own root: a lane reference is
  validated pipeline-scoped and not root-scoped, so a closure MAY legally span two roots, and narrowing trips the
  engine's single-root shortcut, which remaps the foreign root's lane step onto the surviving root and evaluates it
  against the wrong frame — returning 200 with wrong rows rather than failing
- Read the returned rows from the target node's own retained frame, not from the walk's terminal frame
- Report `stepCounts` covering EVERY node in the executed closure, including the steps of a referenced secondary lane —
  those nodes genuinely executed, and omitting them would report a rejoin as produced from inputs the response claims
  never ran
- Return `200 OK` on success
- Return `404 Not Found` if the pipeline or step is not found
- Return `422 Unprocessable Entity` if the source type is unsupported (RestApi, Sql)

#### Scenario: Returns first 10 rows for a valid step
- **WHEN** `GET /api/pipelines/:id/steps/:stepId/preview` is called for a pipeline with a static
  data source and a select step at the root
- **THEN** the response is `200 OK` with a `rows` array containing at most 10 rows and a
  `rowCount` field equal to the total number of rows produced after applying that step

#### Scenario: Steps after the target step are not applied
- **WHEN** a pipeline has a select step followed by a limit step as its child,
  and preview is requested for the select step
- **THEN** the response rows reflect only the select step applied; the limit step is not applied

#### Scenario: Previewing a rejoin whose secondary lane is not an ancestor
- **WHEN** preview is requested for a `join` step whose `secondaryInput` is `{kind:"lane", stepId}` naming the
  terminal step of a SIBLING lane that is not among the join's own `parentStepId` ancestors
- **THEN** the response is `200 OK` and the returned rows are the joined result of both lanes — field-for-field
  identical to the rows the real `/run` path materializes for that same node on the same fixture

#### Scenario: Previewing a rejoin whose secondary lane sits under a different root
- **WHEN** preview is requested for a rejoin under one root whose `secondaryInput` is `{kind:"lane", stepId}` naming a
  step under a DIFFERENT root of the same pipeline, the two roots carrying distinguishable source data
- **THEN** the response is `200 OK` and the rows equal what the real `/run` path materializes for that node — in
  particular the referenced lane is evaluated against ITS OWN root's frame, not the target's root's frame

#### Scenario: A rejoin preview reports counts for the referenced lane's steps
- **WHEN** preview is requested for a rejoin consuming a secondary lane
- **THEN** `stepCounts` contains an entry for each step of that secondary lane, alongside the target's own chain

#### Scenario: Sibling lanes not referenced by the target are excluded
- **WHEN** a pipeline has two sibling lanes and preview is requested for the terminal step of one lane, which holds
  no lane reference
- **THEN** the other lane's steps are absent from the executed closure, and the rows reflect only the target's own lane

#### Scenario: A lane consumed by two rejoins is executed once
- **WHEN** preview is requested for a rejoin in a diamond graph where one lane is referenced by more than one rejoin
- **THEN** the executed closure contains each step exactly once, and the call returns `200 OK`

#### Scenario: A graph with no lane reference previews exactly as before
- **WHEN** preview is requested for a step on a pure trunk, or on a trunk-plus-tails graph containing no
  `{kind:"lane"}` secondary input
- **THEN** the returned rows and `rowCount` are byte-identical to the pre-change behaviour

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `GET /api/pipelines/nonexistent/steps/any-step-id/preview` is called
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 404 for unknown step
- **WHEN** `GET /api/pipelines/:id/steps/nonexistent-step-id/preview` is called with a valid pipeline
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 422 for unsupported source type
- **WHEN** the pipeline's source DataSource has type `rest_api` or `sql`
- **THEN** the response is `422 Unprocessable Entity` with a descriptive error message
