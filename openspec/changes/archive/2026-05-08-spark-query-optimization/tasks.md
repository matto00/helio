## 1. Backend — Config Tuning

- [x] 1.1 Add `spark.sql.shuffle.partitions = 4`, `spark.default.parallelism = 4`, and `spark.ui.enabled = false` to `backend/src/main/resources/application.conf` under the spark config block

## 2. Backend — PanelQueryExecutor Optimization

- [x] 2.1 Add `.cache()` before the first DataFrame action and `.unpersist()` after the second in the paginated code path of `PanelQueryExecutor`
- [x] 2.2 Verify non-paginated code path is unchanged (no cache call added)

## 3. Tests — SparkBenchmarkSpec

- [x] 3.1 Create `backend/src/test/scala/com/helio/spark/SparkBenchmarkSpec.scala` with a shared `SparkSession` (`master("local[*]")`, `shuffle.partitions=2`) created in `beforeAll` and stopped in `afterAll`
- [x] 3.2 Implement benchmark helper: takes a thunk, runs 5 warm-up iterations then 20 timed samples, computes p95
- [x] 3.3 Add scenario: simple projection — create 10k-row synthetic DataFrame, select 2 columns, collect; assert p95 < 2000 ms
- [x] 3.4 Add scenario: filter+sort — 10k rows, filter numeric column, sort descending, collect; assert p95 < 2000 ms
- [x] 3.5 Add scenario: aggregation — 100k rows, group-by + sum, collect; assert p95 < 2000 ms
- [x] 3.6 Add scenario: paginated query — 100k rows, page 1 of 10 (pageSize=10), using `PanelQueryExecutor` with `.cache()`; assert p95 < 2000 ms
- [x] 3.7 Log `df.explain(extended = true)` output for each scenario before the timed loop
- [x] 3.8 Run `sbt test` and confirm all benchmark assertions pass; fix any failures
