## ADDED Requirements

### Requirement: pivot-matrix shape reshapes a source into a crosstab via optional pre-aggregate + pivot

The backend SHALL define a `PivotMatrixShape` object in `com.helio.domain.shapes`, registered in
`PipelineShape.Registry` under id `"pivot-matrix"`, whose `expand(params: JsObject)` accepts:

- `"index"` (required, non-empty array of non-empty, non-duplicate strings): the source fields that
  form each output row's key.
- `"column"` (required, non-empty string): the source field whose distinct values become new output
  columns.
- `"values"` (required, non-empty string): the source field whose values are aggregated into each
  pivoted cell.
- `"agg"` (required, one of `"sum"`, `"count"`, `"avg"`, `"min"`, `"max"`, `"first"`, case-insensitive):
  the aggregation function, validated against `PivotStep`'s full supported set (a superset of
  `AggregateStep`'s five).

`expand` SHALL return `Left` with a descriptive message when: `"index"` is missing, empty, or contains
an empty or duplicate field name; `"column"` or `"values"` is missing or empty; `"agg"` is missing or is
not one of the six supported values (case-insensitively); `"column"` appears in `"index"`; `"values"`
appears in `"index"`; or `"values"` equals `"column"` (each of the latter three would let the
pre-aggregate branch's `AggregateStep` `keyMap ++ aggMap` merge silently overwrite an `index`/`column`
groupBy key, or is otherwise self-referential).

On success, `expand` SHALL return:

1. When `agg` (case-insensitively) is `"sum"`, `"avg"`, `"min"`, `"max"`, or `"count"` — exactly two
   `ShapeStepExpansion`s in order: `kind = "aggregate"` with `config` equivalent to
   `AggregateConfig(groupBy = (index :+ column).map(AggregateField(_, "string")), aggregations =
   Vector(Aggregation(alias = values, fn = agg, field = values)))` (original `agg` casing preserved,
   mirroring `AggregateStep`'s own case-insensitive runtime matching), then `kind = "pivot"` with
   `config` equivalent to `PivotConfig(index, column, values, agg = "first")` (duplicates are already
   collapsed by the preceding aggregate step, so pivot's own reduction is the cheapest correct choice).
2. When `agg` (case-insensitively) is `"first"` — exactly one `ShapeStepExpansion`: `kind = "pivot"`
   with `config` equivalent to `PivotConfig(index, column, values, agg = "first")` (the canonical
   lowercase literal, not the caller's original casing — `PivotStep`'s own `cfg.agg` match is exact and
   case-sensitive, unlike `AggregateStep`'s).

No `aggregate` step is ever emitted with `fn = "first"`, since `AggregateStep.apply` has no `"first"`
case and would throw `IllegalArgumentException` at execution time if it did.

#### Scenario: a reducer agg expands to aggregate then pivot

- **WHEN** `PivotMatrixShape.expand` is called with `{"index": ["region"], "column": "quarter",
  "values": "revenue", "agg": "sum"}`
- **THEN** it returns `Right` with exactly two `ShapeStepExpansion`s: the first with `kind =
  "aggregate"` and a config equivalent to `AggregateConfig(Vector(AggregateField("region", "string"),
  AggregateField("quarter", "string")), Vector(Aggregation("revenue", "sum", "revenue")))`, the second
  with `kind = "pivot"` and a config equivalent to `PivotConfig(Vector("region"), "quarter", "revenue",
  "first")`

#### Scenario: agg "first" expands to pivot alone

- **WHEN** `PivotMatrixShape.expand` is called with `{"index": ["region"], "column": "quarter",
  "values": "revenue", "agg": "first"}`
- **THEN** it returns `Right` with exactly one `ShapeStepExpansion`, with `kind = "pivot"` and a config
  equivalent to `PivotConfig(Vector("region"), "quarter", "revenue", "first")`, and no `aggregate` step
  is present

#### Scenario: agg is accepted case-insensitively and normalized appropriately per destination step

- **WHEN** `PivotMatrixShape.expand` is called with `agg = "SUM"`
- **THEN** it returns `Right`, and the resulting `aggregate` step's config carries `Aggregation("revenue",
  "SUM", "revenue")` (original casing preserved, since `AggregateStep` lowercases internally), while the
  `pivot` step's config carries `agg = "first"` (the shape's own hardcoded literal, not derived from the
  caller's casing)

- **WHEN** `PivotMatrixShape.expand` is called with `agg = "FIRST"`
- **THEN** it returns `Right` with a single `pivot` `ShapeStepExpansion` whose config carries `agg =
  "first"` (normalized to lowercase — `PivotStep`'s own `cfg.agg` match has no `.toLowerCase`)

#### Scenario: missing or empty index is rejected

- **WHEN** `PivotMatrixShape.expand` is called with `"index"` absent, `[]`, or containing an empty
  string
- **THEN** it returns `Left` with a descriptive error message and constructs no steps

#### Scenario: duplicate index field names are rejected

- **WHEN** `PivotMatrixShape.expand` is called with `"index": ["region", "region"]`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: missing or empty column or values is rejected

- **WHEN** `PivotMatrixShape.expand` is called with `"column"` or `"values"` absent or `""`
- **THEN** it returns `Left` with a descriptive error message

#### Scenario: unsupported agg is rejected

- **WHEN** `PivotMatrixShape.expand` is called with `agg = "median"`
- **THEN** it returns `Left` with a descriptive error message naming the supported set

#### Scenario: column colliding with index is rejected

- **WHEN** `PivotMatrixShape.expand` is called with `{"index": ["region", "quarter"], "column":
  "quarter", "values": "revenue", "agg": "sum"}`
- **THEN** it returns `Left` with a descriptive error message naming the collision

#### Scenario: values colliding with index is rejected

- **WHEN** `PivotMatrixShape.expand` is called with `{"index": ["region", "revenue"], "column":
  "quarter", "values": "revenue", "agg": "sum"}`
- **THEN** it returns `Left` with a descriptive error message naming the collision

#### Scenario: values equal to column is rejected

- **WHEN** `PivotMatrixShape.expand` is called with `{"index": ["region"], "column": "revenue",
  "values": "revenue", "agg": "sum"}`
- **THEN** it returns `Left` with a descriptive error message naming the collision

### Requirement: pivot-matrix shape declares an unbounded row-count output contract

`PivotMatrixShape.outputContract` SHALL be `OutputContract(rowCount = RowCountContract.Unbounded, fields
= Vector.empty, description = <non-empty>)`, and the description SHALL note that value-column names are
data-dependent and never statically enumerated. `rowCount` is `Unbounded` because the number of distinct
`index` tuples present in the source is unknowable at `expand`-time and is not bounded by any param.
`fields` is empty for two independent reasons: the row key column names are caller-supplied (mirroring
every sibling shape's precedent), and the value columns (`<values>_<v>`) are inherently data-dependent —
`PivotStep`'s own analyze contract (HEL-375) never statically enumerates them either, treating their
absence from a static schema as expected rather than an error.

#### Scenario: outputContract declares Unbounded with empty fields and documents the dynamic-columns caveat

- **WHEN** `PivotMatrixShape.outputContract` is read
- **THEN** `rowCount` is `RowCountContract.Unbounded`, `fields` is empty, and `description` mentions that
  value columns are data-dependent

### Requirement: pivot-matrix expansion is valid against the existing step decode path

Each `ShapeStepExpansion` produced by `PivotMatrixShape.expand` (both the one-step and two-step forms) SHALL
decode successfully when mapped to `CreatePipelineStepRequest(kind, config)` and run through
`PipelineStepConfigCodec.decode(kind, config.compactPrint)`, and SHALL produce a correct crosstab (one
row per distinct `index` tuple, one column per distinct `column` value, cells aggregated via `agg`) when
executed end-to-end through the pipeline engine against a representative source containing duplicate
`(index, column)` pairs.

#### Scenario: expansion executes to a correct crosstab with duplicate index/column pairs pre-collapsed

- **WHEN** the `ShapeStepExpansion`s from a `PivotMatrixShape.expand` call with `agg = "sum"` are built
  into typed `PipelineStep`s and run through the pipeline engine against a source where the same
  `(index, column)` pair appears in more than one row
- **THEN** the engine produces exactly one output row per distinct `index` tuple, with each
  `<values>_<column-value>` cell equal to the sum of `values` across every row sharing that
  `(index, column)` pair, proving the pre-aggregate step correctly pre-collapses duplicates before
  `pivot` runs

#### Scenario: expansion executes to a correct crosstab with agg "first" and no pre-aggregate

- **WHEN** the `ShapeStepExpansion`s from a `PivotMatrixShape.expand` call with `agg = "first"` are built
  into typed `PipelineStep`s and run through the pipeline engine against a source with one row per
  `(index, column)` pair
- **THEN** the engine produces exactly one output row per distinct `index` tuple, with each
  `<values>_<column-value>` cell equal to that pair's raw `values` value

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
  `Set("passthrough", "single-row", "top-n", "time-series", "pivot-matrix")`
- **THEN** the two sets are equal, and `PipelineShape.Registry` has size 5

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
merely "at least one entry") for at least `"single-row"`, `"top-n"`, `"time-series"`, and
`"pivot-matrix"`, so a regression that dropped a specific shape from the catalog projection (while
leaving `Registry.size` unchanged) would be caught.

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
  an entry with `id = "time-series"`, and an entry with `id = "pivot-matrix"`, each with a non-empty
  `paramsSchema`
