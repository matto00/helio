## Why

`PanelQueryExecutor` currently pushes only column selection into Spark; filters, sort, and limit in `PanelQuery`
are ignored entirely, meaning Spark collects all rows and the application server wastes both memory and network
bandwidth processing predicates that Spark's Catalyst optimizer could have eliminated at the scan layer.

## What Changes

- `PanelQueryExecutor.execute()` translates all four `PanelQuery` fields into Spark DataFrame operations applied
  **before** `collectRows()`:
  - `selectedFields` — `df.select(...)` (already present; confirmed as true pushdown)
  - `filters` — each filter expression string passed to `df.filter(expr)`
  - `sort` — `df.orderBy(expr)` when set
  - `limit` — `df.limit(n)` when set
- `PanelQueryExecutorSpec` gains test cases covering filter pushdown, sort pushdown, limit pushdown, and a
  combined scenario (projection + filter + limit).
- No changes to the REST API, `PanelQuery` domain model, or database schema.

## Capabilities

### New Capabilities

- `spark-query-pushdown`: Spark DataFrame operations for filter, sort, and limit are applied before collect(),
  ensuring no in-memory post-processing of query predicates.

### Modified Capabilities

- `panel-query-model`: The existing spec covers `selectedFields` pushdown; the behaviour of `filters`, `sort`,
  and `limit` fields now has concrete pushdown requirements rather than being no-ops.

## Impact

- `backend/src/main/scala/com/helio/spark/PanelQueryExecutor.scala` — core change
- `backend/src/test/scala/com/helio/spark/PanelQueryExecutorSpec.scala` — new test cases
- No frontend, schema, migration, or API contract changes required.

## Non-goals

- Pushing predicates into external SQL or REST API data sources (those follow separate execution paths).
- Dynamic filter expression construction from a structured filter DSL (filters remain raw Spark SQL strings).
- Sorting or pagination of pipeline results (pipeline execution uses `SparkJobSubmitter`, not `PanelQueryExecutor`).
