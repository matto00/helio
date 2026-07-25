## Why

Crosstab/matrix panels want a wide grid: one row per index key, one column per category, aggregated
cells. HEL-391 (registry) and HEL-375 (`pivot` op) exist; this ticket wires them together as the
fourth and final concrete HEL-337 smart shape (`pivot-matrix`), after `single-row` (HEL-393), `top-n`
(HEL-394), and `time-series` (HEL-396).

## What Changes

- Register a `PivotMatrixShape` object in `PipelineShape.Registry` under id `"pivot-matrix"`. Params:
  `index` (non-empty string array), `column` (string), `values` (string), `agg` (one of
  `sum`/`count`/`avg`/`min`/`max`/`first`, case-insensitive, mirroring `PivotStep`'s own supported set).
- `expand` conditionally emits a pre-collapsing `aggregate` step ahead of the `pivot` step: when `agg`
  is a genuine reducer (`sum`/`avg`/`min`/`max`/`count`, all supported by `AggregateStep`), an
  `aggregate` step (`groupBy = index ++ [column]`, one aggregation reducing `values` via `agg`, alias
  `values`) runs first, then `pivot` runs with `agg = "first"` (duplicates are already collapsed).
  When `agg = "first"` (not an `AggregateStep`-supported function), only `pivot` is emitted, using
  `PivotStep`'s own native first-row-wins per-bucket behavior — no pre-aggregate is possible or needed.
- `expand` rejects a params set where `column`/`values` collide with `index` or each other, since
  `AggregateStep`'s `keyMap ++ aggMap` merge would let the pre-aggregate alias silently overwrite a
  groupBy key.
- Declare `outputContract = OutputContract(RowCountContract.Unbounded, Vector.empty, ...)` — one row
  per distinct `index` tuple present in the source (data-dependent, not bounded by any param), and the
  dynamic `<values>_<v>` value columns are never statically enumerable (mirrors `PivotStep`'s own
  analyze-time index-only schema, HEL-375).
- Extend the registry-parity test (`PipelineShapeSpec`) and the named-shape catalog HTTP assertion
  (`PipelineShapeRoutesSpec`) to include `"pivot-matrix"`, per the existing extend-don't-duplicate
  pattern.

## Capabilities

### Modified Capabilities

- `pipeline-shape-registry`: adds the `pivot-matrix` shape requirement (params, conditional expansion,
  output contract) and extends the registry-parity/catalog-naming requirements to include it.

## Impact

- `backend/src/main/scala/com/helio/domain/shapes/`: new `PivotMatrixShape.scala`; `PipelineShape.scala`
  registry map gains one entry.
- Tests: new `PivotMatrixShapeSpec` (expand validation), new `PivotMatrixShapeEngineSpec` (end-to-end
  run over a fixture with duplicate index/column pairs), extended `PipelineShapeSpec` and
  `PipelineShapeRoutesSpec`.
- No Flyway migration, no wire/schema change to any existing endpoint — additive only.

## Non-goals

- Panel wiring, MCP surface, editor UX — sibling tickets (399/400/402).
- A new pipeline op — `aggregate` and `pivot` are both existing.
- Statically enumerating pivot's dynamic value columns in `outputContract.fields` — the epic-level
  `OutputFieldContract` static-vs-param-driven tension is being raised separately by the human; this
  shape follows every sibling's `fields = Vector.empty` precedent, which is also the only honest answer
  given `pivot`'s data-dependent column set.
