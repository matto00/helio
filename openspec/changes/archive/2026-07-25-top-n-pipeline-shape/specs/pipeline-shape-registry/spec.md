## ADDED Requirements

### Requirement: top-n shape sorts and limits a source by a measure

The backend SHALL define a `TopNShape` object in `com.helio.domain.shapes`, registered in
`PipelineShape.Registry` under id `"top-n"`, whose `expand(params: JsObject)` accepts:

- `"measure"` (required, non-empty string): the field to sort by.
- `"direction"` (required, `"asc"` or `"desc"`, case-insensitive): sort direction.
- `"n"` (required, positive integer): the row cap.
- `"ties"` (optional, defaults to `"strict"` when absent): the tie-break policy. Only `"strict"`
  is implemented.

`expand` SHALL return `Left` with a descriptive message when: `"measure"` is missing or empty;
`"direction"` is missing or is neither `"asc"` nor `"desc"` (case-insensitively); `"n"` is missing,
not an integer, or `<= 0`; or `"ties"` is present and is not `"strict"` (a `"keep-ties"`/dense
variant is deferred — the message SHALL note that it requires the `window` op and is not yet
supported). On success, `expand` SHALL return exactly two `ShapeStepExpansion`s in order:
`kind = "sort"` with `config` equivalent to `SortConfig(Vector(SortKey(measure, direction)))`, then
`kind = "limit"` with `config` equivalent to `LimitConfig(n)`.

#### Scenario: valid params expand to sort then limit

- **WHEN** `TopNShape.expand` is called with `{"measure": "revenue", "direction": "desc", "n": 5}`
- **THEN** it returns `Right` with exactly two `ShapeStepExpansion`s: the first with `kind = "sort"`
  and a config equivalent to `SortConfig(Vector(SortKey("revenue", "desc")))`, the second with
  `kind = "limit"` and a config equivalent to `LimitConfig(5)`

#### Scenario: direction is accepted case-insensitively

- **WHEN** `TopNShape.expand` is called with `{"measure": "revenue", "direction": "DESC", "n": 5}`
- **THEN** it returns `Right`, and the resulting `sort` step's `SortKey.direction` is `"DESC"`
  (passed through unchanged, since `SortStep` itself compares direction case-insensitively)

#### Scenario: missing or non-positive n is rejected

- **WHEN** `TopNShape.expand` is called with `"n"` absent, or with `"n": 0`, or with `"n": -1`
- **THEN** it returns `Left` with a descriptive error message and constructs no steps

#### Scenario: unknown direction is rejected

- **WHEN** `TopNShape.expand` is called with `{"measure": "revenue", "direction": "sideways", "n": 5}`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: missing or empty measure is rejected

- **WHEN** `TopNShape.expand` is called with `"measure"` absent or `""`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: an unsupported ties value is rejected with a deferral message

- **WHEN** `TopNShape.expand` is called with `{"measure": "revenue", "direction": "desc", "n": 5, "ties": "keep-ties"}`
- **THEN** it returns `Left` with a message noting that `"keep-ties"` is not yet supported and
  requires the `window` op

### Requirement: top-n ties are broken deterministically by original input order

The default (`"strict"`) `ties` policy SHALL break ties at the Nth/(N+1)th row boundary by each
tied row's original position in the input, relying on `SortStep`'s documented stable-sort
guarantee — no additional index bookkeeping is introduced by `TopNShape` itself.

#### Scenario: tied rows at the N/N+1 boundary keep the earlier-input row

- **WHEN** the `ShapeStepExpansion`s from `TopNShape.expand({"measure": "score", "direction": "desc", "n": 2})`
  are run through the pipeline engine against three rows where the 2nd and 3rd input rows are tied
  on `score`
- **THEN** the engine's output contains the 1st and 2nd input rows (in that original relative
  order), and excludes the 3rd

### Requirement: top-n shape declares an at-most-n-rows output contract

`TopNShape.outputContract` SHALL be `OutputContract(rowCount = RowCountContract.AtMostParam("n"),
fields = Vector.empty, description = <non-empty>)`. `fields` is empty because the output columns
mirror whatever the source provides, unchanged by `sort`/`limit`, mirroring `passthrough`'s and
`single-row`'s precedent of leaving param/data-driven field sets empty.

#### Scenario: outputContract declares AtMostParam("n") with empty fields

- **WHEN** `TopNShape.outputContract` is read
- **THEN** `rowCount` is `RowCountContract.AtMostParam("n")` and `fields` is empty

### Requirement: top-n expansion is valid against the existing step decode path

Each `ShapeStepExpansion` produced by `TopNShape.expand` SHALL decode successfully when mapped to
`CreatePipelineStepRequest(kind, config)` and run through
`PipelineStepConfigCodec.decode(kind, config.compactPrint)`, and SHALL produce at most `n` output
rows, sorted by `measure`/`direction`, when executed end-to-end through the pipeline engine against
a representative source dataset with more than `n` rows.

#### Scenario: expansion executes to the correct top-N rows

- **WHEN** the `ShapeStepExpansion`s from a `TopNShape.expand` call with `n = 3` are built into
  typed `PipelineStep`s and run through the pipeline engine against a source with 10 rows
- **THEN** the engine produces exactly 3 output rows, sorted by `measure`/`direction`, matching the
  3 highest (or lowest, per `direction`) `measure` values in the source

## MODIFIED Requirements

### Requirement: PipelineShape.Registry enumerates every registered shape

The backend SHALL define `PipelineShape.Registry: Map[String, PipelineShape]` keyed by each shape's
`id`, and `PipelineShape.shapeFor(id: String): Either[String, PipelineShape]` returning `Left` with a
message listing valid ids when `id` is not registered. The backend SHALL also maintain a registry-parity
test asserting `PipelineShape.Registry.keySet` against an independently-authored literal id set, so a
`Registry` entry added without a matching literal (or vice versa) fails the test — mirroring
`ConnectorRegistrySpec`'s drift-detection pattern.

#### Scenario: Registry lookup succeeds for a registered shape

- **WHEN** `PipelineShape.shapeFor("passthrough")` is called
- **THEN** it returns `Right` with the registered `PassthroughShape` instance

#### Scenario: Registry lookup fails for an unknown shape id

- **WHEN** `PipelineShape.shapeFor("does-not-exist")` is called
- **THEN** it returns `Left` with a message listing the registered shape ids

#### Scenario: Registry contains exactly the registered shapes, matching an independently-authored id set

- **WHEN** `PipelineShape.Registry.keySet` is compared against an independently-authored literal
  `Set("passthrough", "single-row", "top-n")`
- **THEN** the two sets are equal, and `PipelineShape.Registry` has size 3

### Requirement: single-row shape reduces a source to exactly one row

The backend SHALL define a `SingleRowShape` object in `com.helio.domain.shapes`, registered in
`PipelineShape.Registry` under id `"single-row"`, whose `expand(params: JsObject)` supports two modes
selected by a required `"mode"` param:

- `"aggregate"`: a required, non-empty `"measures"` array of `{ fn, field, alias }` objects (reusing
  `com.helio.domain.steps.Aggregation`'s wire shape). `expand` SHALL return `Left` if `fn`
  (case-insensitively) is not one of `sum`, `avg`, `min`, `max`, `count`, if any of `fn`/`field`/`alias`
  is empty, or if two measures share the same `alias`. `fn` matching SHALL be case-insensitive,
  mirroring `AggregateStep.apply`'s own case-insensitive runtime matching (`fn.toLowerCase`) — the
  validation layer SHALL NOT be stricter than the step it guards. On success it SHALL return exactly one
  `ShapeStepExpansion` with `kind = "aggregate"` and a config equivalent to
  `AggregateConfig(groupBy = Vector.empty, aggregations = measures)`.
- `"filter"`: a required, non-empty `"conditions"` array of `{ field, operator, value }` objects (reusing
  `com.helio.domain.steps.FilterCondition`'s wire shape) plus an optional `"combinator"` (`"AND"` or
  `"OR"`, case-insensitive, defaults to `"AND"`). `expand` SHALL return `Left` if `operator` is not one of
  `=`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `is null`, `is not null`, if `field` is empty, or if
  `combinator` (when present) is neither `"AND"` nor `"OR"`. On success it SHALL return exactly two
  `ShapeStepExpansion`s in order: `kind = "filter"` (the conditions/combinator), then `kind = "limit"`
  with `config = LimitConfig(1)`.

`expand` SHALL return `Left` with a descriptive message when `"mode"` is missing or is neither
`"aggregate"` nor `"filter"`.

#### Scenario: aggregate mode expands to one empty-groupBy aggregate step

- **WHEN** `SingleRowShape.expand` is called with `{"mode": "aggregate", "measures": [{"fn": "sum", "field": "amount", "alias": "total"}]}`
- **THEN** it returns `Right` with exactly one `ShapeStepExpansion` whose `kind` is `"aggregate"` and whose
  `config` decodes to `AggregateConfig(Vector.empty, Vector(Aggregation("total", "sum", "amount")))`

#### Scenario: aggregate mode accepts an uppercase fn case-insensitively

- **WHEN** `SingleRowShape.expand` is called with `{"mode": "aggregate", "measures": [{"fn": "SUM", "field": "amount", "alias": "total"}]}`
- **THEN** it returns `Right` with exactly one `ShapeStepExpansion` whose `config` decodes to an
  `AggregateConfig` carrying `Aggregation("total", "SUM", "amount")` (the original casing is preserved
  on the wire; only validation is case-insensitive, matching `AggregateStep.apply`'s own lowering at
  execution time)

#### Scenario: filter mode expands to filter then limit-1

- **WHEN** `SingleRowShape.expand` is called with `{"mode": "filter", "conditions": [{"field": "id", "operator": "=", "value": "42"}]}`
- **THEN** it returns `Right` with exactly two `ShapeStepExpansion`s: the first with `kind = "filter"` and
  a config equivalent to `FilterConfig("AND", Vector(FilterCondition("id", "=", Some("42"))))`, the second
  with `kind = "limit"` and `config` decoding to `LimitConfig(1)`

#### Scenario: aggregate mode rejects an unsupported aggregation function

- **WHEN** `SingleRowShape.expand` is called with `{"mode": "aggregate", "measures": [{"fn": "median", "field": "amount", "alias": "total"}]}`
- **THEN** it returns `Left` with a descriptive error message and constructs no steps

#### Scenario: aggregate mode rejects duplicate measure aliases

- **WHEN** `SingleRowShape.expand` is called with two measures sharing the alias `"total"`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: filter mode rejects an unsupported operator

- **WHEN** `SingleRowShape.expand` is called with a condition whose `operator` is `"between"`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: missing or unknown mode is rejected

- **WHEN** `SingleRowShape.expand` is called with `{}` or with `{"mode": "unknown"}`
- **THEN** it returns `Left` with a descriptive error message

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
the database. The response array SHALL include an entry whose `id` is a named, specific shape (not
merely "at least one entry") for at least `"single-row"` and `"top-n"`, so a regression that dropped a
specific shape from the catalog projection (while leaving `Registry.size` unchanged) would be caught.

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

#### Scenario: The catalog response names specific registered shapes

- **WHEN** an authenticated client sends `GET /api/pipeline-shapes`
- **THEN** the response array contains an entry with `id = "single-row"` and an entry with
  `id = "top-n"`, each with a non-empty `paramsSchema`
