## MODIFIED Requirements

### Requirement: OutputContract declares the shape-level output guarantee
The backend SHALL define `OutputContract(rowCount: RowCountContract, description: String)` in
`com.helio.domain.shapes`, where `RowCountContract` is one of `ExactlyOne`, `AtMostParam(paramName:
String)`, or `Unbounded`. `OutputContract` carries no statically-declared field list — a prior
`OutputFieldContract`/`fields: Vector[OutputFieldContract]` member was removed as YAGNI (zero producers,
zero consumers across the entire shipped shape epic; `outputContract` is a static `val` with no access to
`params`, so it structurally could never express param-derived field sets). Any surface needing a shape's
actual output columns SHALL bind via the runtime `DataType` schema produced after instantiate → run
(HEL-399), not a static field declaration.

#### Scenario: OutputContract carries no fields member
- **WHEN** `PassthroughShape.outputContract` is read
- **THEN** it exposes exactly `rowCount` and `description` — there is no `fields` member to read

### Requirement: GET /api/pipeline-shapes returns the shape catalog

The backend SHALL expose `GET /api/pipeline-shapes` (a distinct top-level route prefix — NOT nested
under `/api/pipelines/`, since `PipelineRoutes`'s unvalidated `path(PipelineIdSegment)` matcher would
otherwise swallow a `shapes` literal segment as a pipeline-id lookup before it reached a shapes route;
this mirrors the existing `pipeline-steps` sibling-prefix convention) in the authenticated route tree
(`PipelineShapeRoutes`, logic in `PipelineShapeService`), returning a JSON array with one entry per
`PipelineShape.Registry` value, each carrying `id`, `label`, `description`, `paramsSchema` (array of
`{ name, label, dataType, required, description }`), and `outputContract` (`{ rowCount, description }`,
where `rowCount` is `{ kind: "exactly-one" | "at-most-param" | "unbounded", paramName? }`). The
`outputContract` object SHALL NOT include a `fields` property. The endpoint SHALL require authentication,
matching sibling pipeline routes, and SHALL NOT touch the database. The response array SHALL include an
entry whose `id` is a named, specific shape (not merely "at least one entry") for at least
`"single-row"`, `"top-n"`, `"time-series"`, and `"pivot-matrix"`, so a regression that dropped a specific
shape from the catalog projection (while leaving `Registry.size` unchanged) would be caught.

#### Scenario: Authenticated client fetches the shape catalog

- **WHEN** an authenticated client sends `GET /api/pipeline-shapes`
- **THEN** the response is `200 OK` with a JSON array containing at least the `passthrough` entry,
  including its `paramsSchema` and `outputContract`, and no entry's `outputContract` contains a `fields`
  key

#### Scenario: Unauthenticated request is rejected

- **WHEN** a client sends `GET /api/pipeline-shapes` without a valid session/token
- **THEN** the response is `401 Unauthorized`, matching the existing authenticated-route-tree behavior
  for sibling pipeline endpoints

#### Scenario: The catalog route is reachable through the real composed route tree

- **WHEN** an authenticated client sends `GET /api/pipeline-shapes` through the fully composed
  `ApiRoutes` route tree (not an isolated `PipelineShapeRoutes` test double)
- **THEN** the response is `200 OK` with the shape catalog — never a pipeline-not-found error from
  `PipelineRoutes`'s `path(PipelineIdSegment)` branch or any other sibling route

#### Scenario: The catalog response names specific registered shapes

- **WHEN** an authenticated client sends `GET /api/pipeline-shapes`
- **THEN** the response array contains an entry with `id = "single-row"`, an entry with `id = "top-n"`,
  an entry with `id = "time-series"`, and an entry with `id = "pivot-matrix"`, each with a non-empty
  `paramsSchema`

### Requirement: single-row shape declares an exactly-one-row output contract
`SingleRowShape.outputContract` SHALL be `OutputContract(rowCount = RowCountContract.ExactlyOne,
description = <non-empty>)`.

#### Scenario: outputContract declares ExactlyOne
- **WHEN** `SingleRowShape.outputContract` is read
- **THEN** `rowCount` is `RowCountContract.ExactlyOne`

### Requirement: top-n shape declares an at-most-n-rows output contract

`TopNShape.outputContract` SHALL be `OutputContract(rowCount = RowCountContract.AtMostParam("n"),
description = <non-empty>)`.

#### Scenario: outputContract declares AtMostParam("n")

- **WHEN** `TopNShape.outputContract` is read
- **THEN** `rowCount` is `RowCountContract.AtMostParam("n")`

### Requirement: time-series shape declares an unbounded row-count output contract

`TimeSeriesShape.outputContract` SHALL be `OutputContract(rowCount = RowCountContract.Unbounded,
description = <non-empty>)`. `rowCount` is `Unbounded` because the number of distinct buckets is a
function of the source data's date range and `granularity`, unknowable at `expand`-time. The shape's real
output field list (the bucket column plus each measure alias) is documented in the prose `description`
rather than a structured field list, since there is no structured member to carry it.

#### Scenario: outputContract declares Unbounded

- **WHEN** `TimeSeriesShape.outputContract` is read
- **THEN** `rowCount` is `RowCountContract.Unbounded`

### Requirement: pivot-matrix shape declares an unbounded row-count output contract

`PivotMatrixShape.outputContract` SHALL be `OutputContract(rowCount = RowCountContract.Unbounded,
description = <non-empty>)`, and the description SHALL note that value-column names are data-dependent
and never statically enumerated. `rowCount` is `Unbounded` because the number of distinct `index` tuples
present in the source is unknowable at `expand`-time and is not bounded by any param.

#### Scenario: outputContract declares Unbounded and documents the dynamic-columns caveat

- **WHEN** `PivotMatrixShape.outputContract` is read
- **THEN** `rowCount` is `RowCountContract.Unbounded`, and `description` mentions that value columns are
  data-dependent
