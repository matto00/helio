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
  `Set("passthrough", "single-row", "top-n", "time-series")`
- **THEN** the two sets are equal, and `PipelineShape.Registry` has size 4

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
merely "at least one entry") for at least `"single-row"`, `"top-n"`, and `"time-series"`, so a
regression that dropped a specific shape from the catalog projection (while leaving `Registry.size`
unchanged) would be caught.

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
- **THEN** the response array contains an entry with `id = "single-row"`, an entry with `id = "top-n"`,
  and an entry with `id = "time-series"`, each with a non-empty `paramsSchema`

### Requirement: Shape abstraction is purely additive
This change SHALL NOT alter the behavior, wire shape, or persistence of any existing pipeline, step,
or step CRUD endpoint, and SHALL introduce no Flyway migration — registering the `PipelineShape`
abstraction, the `passthrough` reference shape, and the catalog endpoint is purely additive.

#### Scenario: Existing step CRUD is unaffected
- **WHEN** the backend test suite runs after this change
- **THEN** every pre-existing `PipelineStep`/`PipelineService` test continues to pass unmodified, and
  no new Flyway migration file is added

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

### Requirement: single-row shape declares an exactly-one-row output contract
`SingleRowShape.outputContract` SHALL be `OutputContract(rowCount = RowCountContract.ExactlyOne, fields =
Vector.empty, description = <non-empty>)`. `fields` is empty because the output field set is determined
by caller-supplied params (measure aliases in `"aggregate"` mode, source columns passed through in
`"filter"` mode) rather than fixed by the shape itself, mirroring `PassthroughShape`'s precedent.

#### Scenario: outputContract declares ExactlyOne with empty fields
- **WHEN** `SingleRowShape.outputContract` is read
- **THEN** `rowCount` is `RowCountContract.ExactlyOne` and `fields` is empty

### Requirement: single-row expansion is valid against the existing step decode path
Each `ShapeStepExpansion` produced by `SingleRowShape.expand` (both modes) SHALL decode successfully when
mapped to `CreatePipelineStepRequest(kind, config)` and run through
`PipelineStepConfigCodec.decode(kind, config.compactPrint)`, and SHALL produce exactly one output row when
executed end-to-end through the pipeline engine against a representative source dataset.

#### Scenario: aggregate-mode expansion executes to one row
- **WHEN** the `ShapeStepExpansion`(s) from an `"aggregate"`-mode `expand` call are built into typed
  `PipelineStep`s and run through the pipeline engine against a multi-row source
- **THEN** the engine produces exactly one output row containing the declared measure aliases

#### Scenario: filter-mode expansion executes to one row
- **WHEN** the `ShapeStepExpansion`(s) from a `"filter"`-mode `expand` call are built into typed
  `PipelineStep`s and run through the pipeline engine against a source where the conditions match more
  than one row
- **THEN** the engine produces exactly one output row (the first match), proving the `limit 1` step is
  applied after the `filter` step

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

### Requirement: time-series shape buckets and aggregates a time column

The backend SHALL define a `TimeSeriesShape` object in `com.helio.domain.shapes`, registered in
`PipelineShape.Registry` under id `"time-series"`, whose `expand(params: JsObject)` accepts:

- `"timeField"` (required, non-empty string): the timestamp field to bucket.
- `"granularity"` (required, one of `"day"`, `"week"`, `"month"`, `"quarter"`, `"year"`,
  case-insensitive): the bucket width, normalized to lowercase before being written into the
  `datebucket` step's config (`DateBucketStep`'s own granularity match is case-sensitive, unlike
  `AggregateStep`'s `fn`).
- `"measures"` (required, non-empty array of `{ fn, field, alias }`, reusing
  `com.helio.domain.steps.Aggregation`'s wire shape): `fn` SHALL be validated case-insensitively
  against `sum`, `avg`, `min`, `max`, `count` (mirroring `AggregateStep.apply`'s own
  `fn.toLowerCase` matching), with the original casing preserved on the wire, matching
  `SingleRowShape`'s convention for the same field.

`expand` SHALL return `Left` with a descriptive message when: `"timeField"` is missing or empty;
`"granularity"` is missing or is not one of the five supported values (case-insensitively); `"measures"`
is missing, not an array, or empty; any measure has an unsupported `fn`, an empty `field`, or an empty
`alias`; two measures share the same `alias`; or any measure's `alias` equals `"timeField"`'s value
(a colliding alias would let `AggregateStep`'s `keyMap ++ aggMap` merge silently overwrite the bucket
value). On success, `expand` SHALL return exactly three `ShapeStepExpansion`s in order:

1. `kind = "datebucket"` with `config` equivalent to `DateBucketConfig(timeField, <lowercased
   granularity>, outputColumn = None)` — the bucketed value overwrites `timeField` in place.
2. `kind = "aggregate"` with `config` equivalent to `AggregateConfig(groupBy =
   Vector(AggregateField(timeField, "string")), aggregations = measures)`.
3. `kind = "sort"` with `config` equivalent to `SortConfig(Vector(SortKey(timeField, "asc")))`.

#### Scenario: valid params expand to datebucket, aggregate, then sort

- **WHEN** `TimeSeriesShape.expand` is called with `{"timeField": "orderedAt", "granularity": "month",
  "measures": [{"fn": "sum", "field": "amount", "alias": "total"}]}`
- **THEN** it returns `Right` with exactly three `ShapeStepExpansion`s: the first with
  `kind = "datebucket"` and a config equivalent to `DateBucketConfig("orderedAt", "month", None)`, the
  second with `kind = "aggregate"` and a config equivalent to
  `AggregateConfig(Vector(AggregateField("orderedAt", "string")), Vector(Aggregation("total", "sum", "amount")))`,
  the third with `kind = "sort"` and a config equivalent to `SortConfig(Vector(SortKey("orderedAt", "asc")))`

#### Scenario: granularity is accepted case-insensitively and normalized to lowercase

- **WHEN** `TimeSeriesShape.expand` is called with `{"timeField": "orderedAt", "granularity": "MONTH",
  "measures": [{"fn": "sum", "field": "amount", "alias": "total"}]}`
- **THEN** it returns `Right`, and the resulting `datebucket` step's `granularity` config value is the
  lowercased `"month"`, not the original `"MONTH"`

#### Scenario: measure fn is accepted case-insensitively with original casing preserved

- **WHEN** `TimeSeriesShape.expand` is called with a measure `{"fn": "SUM", "field": "amount", "alias":
  "total"}`
- **THEN** it returns `Right`, and the resulting `aggregate` step's config carries
  `Aggregation("total", "SUM", "amount")` (original casing preserved; only validation is
  case-insensitive)

#### Scenario: missing or empty timeField is rejected

- **WHEN** `TimeSeriesShape.expand` is called with `"timeField"` absent or `""`
- **THEN** it returns `Left` with a descriptive error message and constructs no steps

#### Scenario: unknown granularity is rejected

- **WHEN** `TimeSeriesShape.expand` is called with `{"timeField": "orderedAt", "granularity":
  "fortnight", "measures": [{"fn": "sum", "field": "amount", "alias": "total"}]}`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: empty or missing measures is rejected

- **WHEN** `TimeSeriesShape.expand` is called with `"measures"` absent or `[]`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: unsupported measure fn is rejected

- **WHEN** `TimeSeriesShape.expand` is called with a measure whose `fn` is `"median"`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: duplicate measure aliases are rejected

- **WHEN** `TimeSeriesShape.expand` is called with two measures sharing the alias `"total"`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: a measure alias colliding with timeField is rejected

- **WHEN** `TimeSeriesShape.expand` is called with `{"timeField": "orderedAt", "granularity": "day",
  "measures": [{"fn": "sum", "field": "amount", "alias": "orderedAt"}]}`
- **THEN** it returns `Left` with a descriptive error message naming the collision, and constructs no
  steps

### Requirement: time-series shape declares an unbounded row-count output contract

`TimeSeriesShape.outputContract` SHALL be `OutputContract(rowCount = RowCountContract.Unbounded, fields
= Vector.empty, description = <non-empty>)`. `rowCount` is `Unbounded` because the number of distinct
buckets is a function of the source data's date range and `granularity`, unknowable at `expand`-time.
`fields` is empty because the bucket column's name (`timeField`) and the measure aliases are both
caller-supplied rather than fixed by the shape itself, mirroring `single-row`'s and `top-n`'s
empty-`fields` precedent.

#### Scenario: outputContract declares Unbounded with empty fields

- **WHEN** `TimeSeriesShape.outputContract` is read
- **THEN** `rowCount` is `RowCountContract.Unbounded` and `fields` is empty

### Requirement: time-series expansion is valid against the existing step decode path

Each `ShapeStepExpansion` produced by `TimeSeriesShape.expand` SHALL decode successfully when mapped to
`CreatePipelineStepRequest(kind, config)` and run through
`PipelineStepConfigCodec.decode(kind, config.compactPrint)`, and SHALL produce exactly one output row
per distinct bucket present in the source, ordered chronologically by bucket, when executed end-to-end
through the pipeline engine against a representative dated dataset.

#### Scenario: expansion executes to one row per bucket, ordered chronologically

- **WHEN** the `ShapeStepExpansion`s from a `TimeSeriesShape.expand` call with `granularity = "month"`
  are built into typed `PipelineStep`s and run through the pipeline engine against a source with
  timestamped rows spanning three distinct months, in a shuffled (non-chronological) input order
- **THEN** the engine produces exactly three output rows, one per month, each carrying the correct
  aggregated measure value for that month's rows, ordered chronologically ascending by the bucket
  column

