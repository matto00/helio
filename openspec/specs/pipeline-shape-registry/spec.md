# pipeline-shape-registry Specification

## Purpose
Defines the `PipelineShape` abstraction, registry, and `GET /api/pipeline-shapes` catalog endpoint —
named, parameterized templates that expand into ordinary pipeline steps and declare a guaranteed
output contract, so panels and agents can discover and bind to pre-configured shapes (single value /
top-N / time series / pivot) instead of hand-building raw step lists.
## Requirements
### Requirement: PipelineShape trait defines the shape contract
The backend SHALL define a `PipelineShape` trait in `com.helio.domain.shapes` exposing: `id: String`,
`label: String`, `description: String`, `paramsSchema: Vector[ShapeParamDescriptor]`,
`outputContract: OutputContract`, and `expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]]`.
`expand` SHALL be a pure function — no repository, network, or `ActorSystem` access — and SHALL return
`Left(message)` when `params` is missing a required field or fails to decode into the shape's typed
params model, rather than throwing.

#### Scenario: expand succeeds with valid params
- **WHEN** `PassthroughShape.expand` is called with `{"fields": ["a", "b"]}`
- **THEN** it returns `Right` with a `Vector` containing exactly one `ShapeStepExpansion` whose `kind`
  is `"select"` and whose `config` decodes to `SelectConfig(Vector("a", "b"))`

#### Scenario: expand rejects invalid params
- **WHEN** `PassthroughShape.expand` is called with params missing the required `fields` key
- **THEN** it returns `Left` with a descriptive error message and constructs no steps

### Requirement: ShapeStepExpansion mirrors the step create-payload shape
`ShapeStepExpansion(kind: String, config: JsObject)` SHALL be defined in `com.helio.domain.shapes` and
SHALL carry the same two fields (discriminator + typed config object) as
`com.helio.api.protocols.CreatePipelineStepRequest`, so a 1:1 field mapping between the two types
round-trips through `PipelineStepConfigCodec.decode` without alteration.

#### Scenario: Expansion is valid against the existing step decode path
- **WHEN** each `ShapeStepExpansion` produced by a registered shape's `expand` is mapped to
  `CreatePipelineStepRequest(kind, config)` and decoded via `PipelineStepConfigCodec.decode(kind, config.compactPrint)`
- **THEN** the decode succeeds for every expansion entry, proving the expansion is a valid ordinary
  step create-payload

### Requirement: OutputContract declares the shape-level output guarantee
The backend SHALL define `OutputContract(rowCount: RowCountContract, fields: Vector[OutputFieldContract], description: String)`
in `com.helio.domain.shapes`, where `RowCountContract` is one of `ExactlyOne`,
`AtMostParam(paramName: String)`, or `Unbounded`, and each `OutputFieldContract` carries
`name: String`, `dataType: DataFieldType`, `nullable: Boolean`. `fields` MAY be empty
when the shape's output field set is fully determined by caller-supplied params rather than fixed by
the shape itself.

#### Scenario: A shape with param-driven fields declares an empty fields list
- **WHEN** `PassthroughShape.outputContract` is read
- **THEN** `rowCount` is `RowCountContract.Unbounded` and `fields` is empty, since the output field set
  is exactly whatever the caller passed in `params.fields`

### Requirement: PipelineShape.Registry enumerates every registered shape
The backend SHALL define `PipelineShape.Registry: Map[String, PipelineShape]` keyed by each shape's
`id`, and `PipelineShape.shapeFor(id: String): Either[String, PipelineShape]` returning `Left` with a
message listing valid ids when `id` is not registered.

#### Scenario: Registry lookup succeeds for a registered shape
- **WHEN** `PipelineShape.shapeFor("passthrough")` is called
- **THEN** it returns `Right` with the registered `PassthroughShape` instance

#### Scenario: Registry lookup fails for an unknown shape id
- **WHEN** `PipelineShape.shapeFor("does-not-exist")` is called
- **THEN** it returns `Left` with a message listing the registered shape ids

### Requirement: GET /api/pipeline-shapes returns the shape catalog
The backend SHALL expose `GET /api/pipeline-shapes` (a distinct top-level route prefix — NOT nested
under `/api/pipelines/`, since `PipelineRoutes`'s unvalidated `path(PipelineIdSegment)` matcher would
otherwise swallow a `shapes` literal segment as a pipeline-id lookup before it reached a shapes route;
this mirrors the existing `pipeline-steps` sibling-prefix convention) in the authenticated route tree
(`PipelineShapeRoutes`, logic in `PipelineShapeService`), returning a JSON array with one entry per
`PipelineShape.Registry` value, each carrying `id`, `label`, `description`, `paramsSchema` (array of
`{ name, label, dataType, required, description }`), and `outputContract` (`{ rowCount, fields,
description }`, where `rowCount` is `{ kind: "exactly-one" | "at-most-param" | "unbounded", paramName?
}`). The endpoint SHALL require authentication, matching sibling pipeline routes, and SHALL NOT touch
the database.

#### Scenario: Authenticated client fetches the shape catalog
- **WHEN** an authenticated client sends `GET /api/pipeline-shapes`
- **THEN** the response is `200 OK` with a JSON array containing at least the `passthrough` entry,
  including its `paramsSchema` and `outputContract`

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client sends `GET /api/pipeline-shapes` without a valid session/token
- **THEN** the response is `401 Unauthorized`, matching the existing authenticated-route-tree behavior
  for sibling pipeline endpoints

#### Scenario: The catalog route is reachable through the real composed route tree
- **WHEN** an authenticated client sends `GET /api/pipeline-shapes` through the fully composed
  `ApiRoutes` route tree (not an isolated `PipelineShapeRoutes` test double)
- **THEN** the response is `200 OK` with the shape catalog — never a pipeline-not-found error from
  `PipelineRoutes`'s `path(PipelineIdSegment)` branch or any other sibling route

### Requirement: Shape abstraction is purely additive
This change SHALL NOT alter the behavior, wire shape, or persistence of any existing pipeline, step,
or step CRUD endpoint, and SHALL introduce no Flyway migration — registering the `PipelineShape`
abstraction, the `passthrough` reference shape, and the catalog endpoint is purely additive.

#### Scenario: Existing step CRUD is unaffected
- **WHEN** the backend test suite runs after this change
- **THEN** every pre-existing `PipelineStep`/`PipelineService` test continues to pass unmodified, and
  no new Flyway migration file is added

