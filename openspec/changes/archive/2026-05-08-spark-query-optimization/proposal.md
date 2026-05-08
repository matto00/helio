## Why

Panel query execution via `PanelQueryExecutor` runs on local Spark with no established latency targets or profiling
coverage. Without a benchmark baseline, regressions are invisible and optimization decisions are guesswork.
Establishing p95 < 2s targets and a repeatable benchmark suite closes this gap before the data pipeline ships.

## What Changes

- Add `SparkBenchmarkSpec` under `backend/src/test/scala/com/helio/spark/` — a ScalaTest suite that spins up a
  local Spark session (`master("local[*]")`) and measures p95 execution time for four panel query scenarios
  (simple select, filter+sort, aggregation, large dataset with pagination).
- Capture and log `df.explain(extended = true)` query plan output per scenario.
- Apply targeted optimizations in `PanelQueryExecutor`: `.cache()` for DataFrames accessed more than once,
  `COALESCE`/`REPARTITION` partition hints where beneficial.
- Tune Spark settings in `application.conf` (e.g. `spark.sql.shuffle.partitions`, `spark.default.parallelism`)
  for local-mode panel query workloads.
- Assert p95 latency < 2000 ms per scenario in the benchmark suite.

## Capabilities

### New Capabilities
- `spark-query-benchmark`: Benchmarking and profiling suite for panel query execution; documents and asserts p95 < 2s targets.

### Modified Capabilities
- `spark-query-pushdown`: Optimization additions to `PanelQueryExecutor` (caching, partition hints) are behaviorally
  transparent but extend the execution contract.

## Impact

- **Backend test**: new file `backend/src/test/scala/com/helio/spark/SparkBenchmarkSpec.scala`.
- **Backend source**: `PanelQueryExecutor.scala` — cache and hint additions.
- **Config**: `backend/src/main/resources/application.conf` — Spark local-mode tuning.
- **No new dependencies** — uses existing spark-core/spark-sql 3.5.5 from build.sbt.
- **No new infrastructure** — tests run with `local[*]` SparkSession.

## Non-goals

- Distributed/cluster Spark tuning (out of scope; local mode only).
- Frontend latency instrumentation or APM integration.
- Persistent benchmark result storage or CI time-series tracking.
