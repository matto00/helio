## Context

`PanelQueryExecutor` (introduced in the `panel-query-executor` change) wraps `SparkJobSubmitter.loadDataFrame()`
and `collectRows()` to execute panel queries. Currently, only `selectedFields` is applied as a Spark
`DataFrame.select()` before collection; the `filters`, `sort`, and `limit` fields of `PanelQuery` are
silently ignored, making them no-ops. The `PanelQueryExecutorSpec` tests confirm this — they exercise
projection but nothing else.

The `PanelQuery` domain model already has all four fields (`selectedFields`, `filters: List[JsValue]`,
`sort: Option[String]`, `limit: Option[Int]`) and filter values are raw Spark SQL expression strings stored
in `JsString` wrappers inside the `filters` list.

## Goals / Non-Goals

**Goals:**
- Apply `filters`, `sort`, and `limit` as Spark DataFrame operations inside `PanelQueryExecutor.execute()`,
  before `collectRows()` is called.
- Test coverage for each pushdown operation individually and in combination.

**Non-Goals:**
- Changing the `PanelQuery` domain model or its JSON serialization.
- Pushing predicates into SQL, REST API, or pipeline execution paths.
- Implementing a structured filter DSL — filters remain raw Spark SQL strings.

## Decisions

### Decision 1: Apply all pushdowns in `PanelQueryExecutor`, not `SparkJobSubmitter`

`SparkJobSubmitter` owns the pipeline execution path (step-based transform chain). `PanelQueryExecutor` is the
dedicated panel query path. Keeping pushdown logic in `PanelQueryExecutor` maintains the separation already
established in the codebase and avoids making `SparkJobSubmitter` aware of panel-level concerns.

Considered: adding a `queryPushdown` helper method to `SparkJobSubmitter`. Rejected because it blurs the
responsibility boundary and would require threading `PanelQuery` through a class that manages pipeline
resources.

### Decision 2: Pushdown order — select → filter → sort → limit

Apply operations in this order on the intermediate DataFrame: projection first (reduces columns early),
then filter (eliminates rows), then sort, then limit. Spark's Catalyst optimizer re-orders physical
execution anyway, but applying limit after sort is semantically correct (top-N semantics).

### Decision 3: Filter expressions are extracted as raw strings from `JsString` values

`filters: List[JsValue]` items that are `JsString(expr)` are passed directly to `df.filter(expr)`.
Non-`JsString` items are skipped with no error (forward-compatible with future structured filter objects).
This is consistent with how `SparkJobSubmitter.applyStep` handles the `"filter"` op: it uses
`df.filter(cfg.fields("expression").convertTo[String])`.

## Risks / Trade-offs

- **Invalid filter expression strings** → Spark throws at plan-analysis time; the exception propagates through
  the Future and surfaces as a 500 in `PanelExecuteRoutes`. Acceptable: malformed expressions are a
  configuration error, not a runtime data issue. Mitigation: tests use valid expressions.
- **Sort on non-existent column** → Same Spark analysis exception path; same mitigation.
- **Local Spark (`local[*]`) in tests** → Already the pattern in `PanelQueryExecutorSpec` and
  `SparkJobSubmitterSpec`; no change required.

## Planner Notes

- Self-approved: the change is purely additive inside a single class + its test file; no API, schema,
  migration, or cross-service impact.
- The `panel-query-model` spec delta documents that `filters`, `sort`, and `limit` are now actively
  pushed down rather than being no-ops.
