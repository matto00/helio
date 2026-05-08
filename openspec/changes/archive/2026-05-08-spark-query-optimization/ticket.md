# HEL-209 — Panel load time baseline and Spark query optimization

## Title
Panel load time baseline and Spark query optimization

## Description
Establish acceptable panel load time targets (e.g. p95 < 2s for typical DataType sizes). Profile Spark query plans for common panel types and optimize (partitioning, caching, plan hints) until targets are met.

## Scope / Context
The helio codebase already has a full Spark integration as of today:
- HEL-201: docker-compose.spark.yml with apache/spark:3.5.0, spark config in application.conf
- HEL-202: SparkJobSubmitter (spark-core 3.5.5 + spark-sql in build.sbt), PipelineRunCache, POST /api/pipelines/:id/run
- HEL-203: Async job tracking, PipelineRepository.updateLastRun
- HEL-204: PipelineRunRepository, GET /api/pipelines/:id/run-history
- HEL-205: PanelQuery model, Panel.buildQuery, GET /api/panels/:id/query
- HEL-206: PanelQueryExecutor (Spark DataFrame ops), POST /api/panels/:id/execute
- HEL-207: Pagination (PanelExecuteRoutes with page/pageSize), PaginatedQueryResult
- HEL-208: Query pushdown (select/filter/sort/limit all pushed into Spark DataFrame ops)

Key files:
- backend/src/main/scala/com/helio/spark/PanelQueryExecutor.scala
- backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala
- backend/build.sbt (has spark-core/spark-sql 3.5.5)

## Acceptance Criteria
1. A benchmarking/profiling suite exists in the Scala test codebase that measures p95 panel load time for common panel types (simple select, filter+sort, aggregation, large dataset with pagination).
2. The suite reports query plan information (explained plan) for each scenario.
3. Optimizations are applied where applicable: `.cache()` for repeated DataFrame access, partition hints, and application.conf Spark config tuning.
4. p95 < 2s target is documented and verified by the benchmarking suite (using in-memory/local Spark so no external infrastructure is required).
5. No new external infrastructure is required — tests run with local Spark (master = "local[*]").

## Implementation Approach
- Add a `SparkBenchmarkSpec` (or similar) under `backend/src/test/scala/com/helio/spark/` using ScalaTest.
- Use a local SparkSession (`master("local[*]")`) with synthetic datasets of representative sizes (e.g. 10k, 100k rows).
- Profile with `df.explain(extended = true)` output captured per scenario.
- Apply optimizations in `PanelQueryExecutor` and/or `application.conf` as needed.
- The benchmark results are logged/asserted in the test output; p95 targets are asserted via timing assertions.
