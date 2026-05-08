## Context

`PanelQueryExecutor` (HEL-206 through HEL-208) executes panel queries against local Spark DataFrames with full
pushdown of select/filter/sort/limit. There are no latency targets, no profiling coverage, and no test-level
benchmark harness. This design adds a repeatable benchmark suite and targeted optimizations — all within the
existing Spark dependency footprint (spark-core/spark-sql 3.5.5).

## Goals / Non-Goals

**Goals:**
- Establish a ScalaTest benchmark suite (`SparkBenchmarkSpec`) that measures p95 wall-clock latency for four
  representative panel query scenarios using synthetic data.
- Capture `df.explain(extended = true)` query plan output per scenario to aid future profiling.
- Apply `.cache()` to DataFrames that are executed more than once within a session.
- Tune `spark.sql.shuffle.partitions` and `spark.default.parallelism` in `application.conf` for local-mode.
- Assert p95 < 2000 ms per scenario.

**Non-Goals:**
- Distributed Spark cluster tuning.
- Frontend latency measurement or APM integration.
- Persisting benchmark time-series results to a database or CI artifact store.

## Decisions

### D1: Test runner — ScalaTest with manual timing, not JMH

JMH would require a new sbt plugin and substantial boilerplate. ScalaTest with manual `System.nanoTime` timing
is already in the toolchain, keeps the diff minimal, and is sufficient to assert a 2-second p95 on warm-up
runs (n=20 repetitions per scenario). The trade-off is less JVM warm-up isolation, which is acceptable given
the 2s target is deliberately conservative for local-mode Spark.

### D2: Local SparkSession per suite — not reusing production config

`SparkBenchmarkSpec` creates its own `SparkSession` with `master("local[*]")` and
`spark.sql.shuffle.partitions = 2`. This isolates benchmarks from any environment-level Spark master and
keeps test runtime short. The production `application.conf` tuning (D4) is a separate concern.

### D3: Synthetic datasets via `spark.createDataFrame`

Scenarios use 10k and 100k-row in-memory datasets created with `spark.createDataFrame(Seq(...))`. This
avoids file I/O and dependency on external data, keeping tests fully hermetic.

### D4: application.conf Spark tuning

For local-mode panel execution (not benchmark-only), set:
- `spark.sql.shuffle.partitions = 4` (default 200 is absurd for single-node local)
- `spark.default.parallelism = 4`
- `spark.ui.enabled = false` (reduces startup overhead in server process)

### D5: `.cache()` applied to DataFrames re-used across pagination pages

In `PanelQueryExecutor`, the same DataFrame may be materialized twice: once for count and once for the page
slice. Applying `.cache()` before the first action and `.unpersist()` after the second eliminates
re-computation. This is the highest-value optimization for paginated queries.

### D6: No partition hints for static-data panel queries

Static DataSource data is loaded in-process as a small-to-medium Seq. COALESCE/REPARTITION hints add overhead
on small datasets. Partition hints are deferred until a connector (CSV, SQL, REST) loads data via distributed
reads — not needed now.

## Risks / Trade-offs

- [JVM warm-up skew] The first 1–2 Spark runs in a suite are slower due to class loading. Mitigation: warm
  up with 5 dry-run iterations before the 20 timed samples; use p95 not mean.
- [SparkSession startup cost ~2–4s] Suite startup adds to total sbt test time. Mitigation: share a single
  SparkSession across all scenarios via `beforeAll`/`afterAll`.
- [application.conf changes affect all test runs] Setting `spark.sql.shuffle.partitions = 4` in shared config
  is fine for local dev; prod with a real cluster would override via SPARK_MASTER_URL env and cluster config.

## Planner Notes

Self-approved: no new external dependencies, no API surface changes, no breaking behavior. Optimizations in
`PanelQueryExecutor` are transparent to callers. application.conf changes are local-mode-safe.
