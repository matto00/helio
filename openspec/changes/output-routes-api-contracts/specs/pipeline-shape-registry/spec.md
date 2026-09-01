## MODIFIED Requirements

### Requirement: POST /api/pipeline-shapes/:id/expand invokes a shape's expand function

The backend SHALL expose `POST /api/pipeline-shapes/:id/expand` in the authenticated route tree
(`PipelineShapeRoutes`, logic in `PipelineShapeService`), accepting a JSON body
`{ "params": <object> }` — the request has NO `parentStepId` field: `pipeline-shapes` is a
pipeline-agnostic template catalog (`ExpandPipelineShapeRequest` never carries a `pipelineId`, so
there is no real, already-persisted step for a request-side `parentStepId` to anchor into) — and
returning, on success, a `200 OK` JSON body `{ steps: [{ clientId: String, kind: String,
config: <object>, parentStepId?: String }], outputs?: [...] }`. **BREAKING**: the response's
top level changes from a bare array to this object (`{ steps, outputs? }`) — every caller reading
the prior bare-array shape must be updated to read `.steps` instead. `steps` has one entry per
`ShapeStepExpansion` produced by `PipelineShape.shapeFor(id).flatMap(_.expand(params))`; each
entry is additionally assigned a synthetic `clientId` (`"step-0"`, `"step-1"`, ... in expansion
order) and a `parentStepId` referencing the PRIOR entry's `clientId` -- **for the FIRST step, the
`parentStepId` key is OMITTED from that entry entirely, never present as a literal `null`**:
`ShapeStepExpansionResponse.parentStepId` is `Option[String]`, serialized via `jsonFormat4` on a
protocol with no `NullOptions` mixed in anywhere in this backend (the same class of imprecision
already fixed for this response's own `outputs` field, and for `OutputResponse.nodeStepId`) — this
is RESPONSE-SIDE chaining metadata, not a request-side field, mirroring
`CreatePipelineTransactionalStepRequest`'s own `clientId`/`parentStepId` convention exactly, so a
caller can pass `steps` straight into that create-transactional endpoint's `steps[]` without
re-deriving the chain itself. **The `outputs` key is OMITTED from the response entirely today,
never present as `outputs: null`**: `ExpandPipelineShapeResponse.outputs` is a Scala
`Option[JsArray] = None`, serialized via `jsonFormat2` on a protocol trait that does NOT mix in
spray-json's `NullOptions` (confirmed: `NullOptions` appears nowhere in this backend) — the
DEFAULT `OptionFormat` DROPS a `None` field from the JSON object rather than writing a literal
`null`. So the actual shipped wire shape for every shape today (none declares Outputs yet,
`PipelineShape`'s domain `OutputContract` being `{ rowCount, description }` only, no
field/Output-declaration data since HEL-623) is `{ "steps": [...] }` with NO `outputs` key at
all — optional-key semantics, `outputs?`, not a nullable-value field. The key exists purely as
forward-compatible wire shape for a future shape that DOES declare Outputs (which would then
serialize as a present `outputs` array, per `jsonFormat2`'s normal `Option[A]`-present
behavior). The endpoint SHALL require authentication, matching sibling pipeline-shape and
pipeline-step routes, and SHALL NOT touch the database (mirrors the existing catalog GET's
"purely additive, no persistence" behavior).

#### Scenario: Expand succeeds for a registered shape with valid params

- **WHEN** an authenticated client sends `POST /api/pipeline-shapes/single-row/expand` with body
  `{"params": {"mode": "aggregate", "measures": [{"fn": "sum", "field": "amount", "alias": "total"}]}}`
- **THEN** the response is `200 OK` with `steps` containing exactly one entry whose `kind` is
  `"aggregate"`, whose `config` matches `AggregateConfig(groupBy = [], aggregations = [{fn: "sum",
  field: "amount", alias: "total"}])`, and whose `clientId` is `"step-0"`; the raw response JSON
  has NO `outputs` key and NO `parentStepId` key on that entry at all (neither is present as
  `null`) — asserted against the raw parsed `JsObject`, not just the unmarshalled case class,
  since `resp.outputs shouldBe None`/`resp.steps.head.parentStepId shouldBe None` cannot
  distinguish "key omitted" from "key present as null"

#### Scenario: Multiple expanded steps chain via clientId/parentStepId

- **WHEN** an authenticated client sends `POST /api/pipeline-shapes/top-n/expand` with valid params
  (a shape whose `expand` produces more than one step)
- **THEN** the response's `steps` array has each entry's `clientId` set to `"step-<index>"` in
  expansion order; the first entry's raw JSON OMITS the `parentStepId` key entirely, and every
  subsequent entry's `parentStepId` is set to the PRIOR entry's `clientId`

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
- **THEN** every pre-existing `PipelineShape`/`PipelineShapeService` domain-level test (expand logic
  itself, unrelated to the HTTP response envelope) continues to pass unmodified, and no new Flyway
  migration file is added; `PipelineShapeRoutes` HTTP-level tests are updated for the new `{ steps,
  outputs }` envelope as part of this change
