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

## ADDED Requirements

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
