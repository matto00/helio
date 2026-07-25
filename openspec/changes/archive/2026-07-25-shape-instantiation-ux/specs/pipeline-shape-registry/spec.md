## ADDED Requirements

### Requirement: POST /api/pipeline-shapes/:id/expand invokes a shape's expand function

The backend SHALL expose `POST /api/pipeline-shapes/:id/expand` in the authenticated route tree
(`PipelineShapeRoutes`, logic in `PipelineShapeService`), accepting a JSON body `{ "params": <object> }`
and returning, on success, a `200 OK` JSON array of `{ kind: String, config: <object> }` entries — one per
`ShapeStepExpansion` produced by `PipelineShape.shapeFor(id).flatMap(_.expand(params))`. The endpoint
SHALL require authentication, matching sibling pipeline-shape and pipeline-step routes, and SHALL NOT
touch the database (mirrors the existing catalog GET's "purely additive, no persistence" behavior).

#### Scenario: Expand succeeds for a registered shape with valid params

- **WHEN** an authenticated client sends `POST /api/pipeline-shapes/single-row/expand` with body
  `{"params": {"mode": "aggregate", "measures": [{"fn": "sum", "field": "amount", "alias": "total"}]}}`
- **THEN** the response is `200 OK` with a JSON array containing exactly one entry whose `kind` is
  `"aggregate"` and whose `config` matches `AggregateConfig(groupBy = [], aggregations = [{fn: "sum",
  field: "amount", alias: "total"}])`

#### Scenario: Expand rejects an unknown shape id

- **WHEN** an authenticated client sends `POST /api/pipeline-shapes/does-not-exist/expand` with any body
- **THEN** the response is `404 Not Found` with an error message listing the registered shape ids
  (`PipelineShape.shapeFor`'s own `Left` message)

#### Scenario: Expand rejects invalid params with the shape's own message

- **WHEN** an authenticated client sends `POST /api/pipeline-shapes/single-row/expand` with body
  `{"params": {"mode": "aggregate"}}` (missing the required `measures` field)
- **THEN** the response is `422 Unprocessable Entity` with an error message equal to the `Left` message
  `SingleRowShape.expand` itself returns for a missing `measures` field — the endpoint SHALL NOT rewrite
  or generalize the shape's own validation message

#### Scenario: Unauthenticated request is rejected

- **WHEN** a client sends `POST /api/pipeline-shapes/single-row/expand` without a valid session/token
- **THEN** the response is `401 Unauthorized`, matching the existing authenticated-route-tree behavior
  for sibling pipeline-shape and pipeline-step endpoints

#### Scenario: Expand is purely additive and touches no persistence

- **WHEN** the backend test suite runs after this change
- **THEN** every pre-existing `PipelineShape`/`PipelineShapeService`/`PipelineShapeRoutes` test continues
  to pass unmodified, and no new Flyway migration file is added
