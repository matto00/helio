## ADDED Requirements

### Requirement: single-row shape reduces a source to exactly one row
The backend SHALL define a `SingleRowShape` object in `com.helio.domain.shapes`, registered in
`PipelineShape.Registry` under id `"single-row"`, whose `expand(params: JsObject)` supports two modes
selected by a required `"mode"` param:

- `"aggregate"`: a required, non-empty `"measures"` array of `{ fn, field, alias }` objects (reusing
  `com.helio.domain.steps.Aggregation`'s wire shape). `expand` SHALL return `Left` if `fn` is not one of
  `sum`, `avg`, `min`, `max`, `count`, if any of `fn`/`field`/`alias` is empty, or if two measures share
  the same `alias`. On success it SHALL return exactly one `ShapeStepExpansion` with `kind = "aggregate"`
  and a config equivalent to `AggregateConfig(groupBy = Vector.empty, aggregations = measures)`.
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
  `Set("passthrough", "single-row")`
- **THEN** the two sets are equal, and `PipelineShape.Registry` has size 2
