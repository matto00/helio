## Why

Line/area charts want one row per time bucket with a measure aggregated over that bucket. HEL-391
(registry) and HEL-378 (`datebucket` op) exist; this ticket wires them together as the third concrete
HEL-337 smart shape (`time-series`), after `single-row` (HEL-393) and `top-n` (HEL-394).

## What Changes

- Register a `TopNShape`-style `TimeSeriesShape` object in `PipelineShape.Registry` under id
  `"time-series"`. Params: `timeField` (string), `granularity` (`day`/`week`/`month`/`quarter`/`year`,
  case-insensitive, normalized to lowercase), `measures` (non-empty array of `{ fn, field, alias }`,
  reusing `Aggregation`'s wire shape, `fn` validated case-insensitively against `AggregateStep`'s
  supported set).
- `expand` builds exactly three `ShapeStepExpansion`s: `datebucket` (floors `timeField` to
  `granularity`, overwriting `timeField` in place), `aggregate` (`groupBy = [timeField]`, the
  `measures`), then `sort` (ascending on `timeField`) — the bucket column's ISO `yyyy-MM-dd` string
  sorts chronologically, and `aggregate`'s hash-map grouping gives no ordering guarantee on its own.
- `expand` rejects any measure `alias` that collides with `timeField`, since `AggregateStep`'s
  `keyMap ++ aggMap` merge would let a colliding alias silently overwrite the bucket value.
- Declare `outputContract = OutputContract(RowCountContract.Unbounded, Vector.empty, ...)` — row count
  is data-dependent (number of distinct buckets present), and the field set (bucket column name +
  measure aliases) is caller-supplied, mirroring `single-row`/`top-n`'s empty-`fields` precedent.
- Extend the registry-parity test (`PipelineShapeSpec`) and the named-shape catalog HTTP assertion
  (`PipelineShapeRoutesSpec`) to include `"time-series"`, per the existing extend-don't-duplicate
  pattern.
- File a HEL-337 spinoff ticket for gap-filling empty time buckets (explicitly out of scope; no
  fill-null-style op exists on main yet).

## Capabilities

### Modified Capabilities

- `pipeline-shape-registry`: adds the `time-series` shape requirement (params, expansion, output
  contract) and extends the registry-parity/catalog-naming requirements to include it.

## Impact

- `backend/src/main/scala/com/helio/domain/shapes/`: new `TimeSeriesShape.scala`; `PipelineShape.scala`
  registry map gains one entry.
- Tests: new `TimeSeriesShapeSpec` (expand validation), new `TimeSeriesShapeEngineSpec` (end-to-end run
  over a dated fixture), extended `PipelineShapeSpec` and `PipelineShapeRoutesSpec`.
- No Flyway migration, no wire/schema change to any existing endpoint — additive only.

## Non-goals

- Gap-filling empty buckets — filed as a HEL-337 spinoff.
- Panel wiring, MCP surface, editor UX — sibling tickets (399/400/402).
- A new pipeline op — `datebucket` + `aggregate` + `sort` are all existing.
