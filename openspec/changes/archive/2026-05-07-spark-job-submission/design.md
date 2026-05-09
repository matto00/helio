## Context

The backend already has `spark.masterUrl` in `application.conf` (defaulting to `spark://localhost:7077`,
overridable via `SPARK_MASTER_URL`) and the Spark cluster is provided by HEL-201's
`docker-compose.spark.yml` (`apache/spark:3.5.0`). Pipeline and step domain models are fully defined
in `model.scala` (`Pipeline`, `PipelineStep`, `PipelineStepId`) and persisted via `PipelineRepository`
and `PipelineStepRepository`. Routes are wired in `ApiRoutes.scala` via `PipelineRoutes`.

The Scala version is 2.13.15. Spark 3.5.x supports Scala 2.13.

## Goals / Non-Goals

**Goals:**
- Add Spark deps without breaking Pekko (which itself superseded Akka; Spark's transitive Akka deps must be excluded)
- Implement `SparkJobSubmitter` in `com.helio.spark` package — translates ordered `PipelineStep` list to DataFrame ops and submits to Spark cluster
- Implement thread-safe `PipelineRunCache` for run status + result rows
- Add `POST /api/pipelines/:id/run` and `GET /api/pipelines/:id/runs/:runId` endpoints

**Non-Goals:**
- Iceberg / result persistence (HEL-232)
- Frontend UI
- ACL enforcement on run endpoints
- Job cancellation or streaming results

## Decisions

### D1: Spark dependency scoping — `compile` with exclusions (not `provided`)
The Spark JARs are not provided by the runtime environment; the backend runs as a standalone JVM that
connects to the Spark cluster as a driver. Therefore the JARs must be in `compile` scope. To avoid
Akka/Pekko conflicts, exclude `akka-actor`, `akka-stream`, and related transitive deps from Spark.
Also exclude Spark's bundled `slf4j` binding and `log4j` to avoid conflicts with logback.

```scala
"org.apache.spark" %% "spark-core" % "3.5.5"
  exclude("org.apache.pekko", "*")
  exclude("com.typesafe.akka", "akka-actor_2.13")
  exclude("com.typesafe.akka", "akka-stream_2.13")
  exclude("com.typesafe.akka", "akka-slf4j_2.13")
  exclude("org.slf4j", "slf4j-log4j12")
  exclude("org.apache.logging.log4j", "log4j-slf4j2-impl"),
"org.apache.spark" %% "spark-sql" % "3.5.5"
  exclude("org.apache.pekko", "*")
  exclude("com.typesafe.akka", "akka-actor_2.13")
  exclude("com.typesafe.akka", "akka-stream_2.13")
  exclude("com.typesafe.akka", "akka-slf4j_2.13")
  exclude("org.slf4j", "slf4j-log4j12")
  exclude("org.apache.logging.log4j", "log4j-slf4j2-impl")
```

Additionally, add `assemblyMergeStrategy` entries for Spark's `module-info.class` files (already
handled by the catch-all `MergeStrategy.first`).

### D2: SparkSession — created once per JVM, master from config
A single `SparkSession` is created at startup (lazy val in companion object) using
`spark.masterUrl` from `application.conf`. Using `SparkSession.builder.master(url).getOrCreate()`
is safe for a single-driver process. The driver runs in local-mode compatible mode
(deploy-mode `client`).

### D3: Async execution — Future wrapping a blocking thread
`SparkJobSubmitter.submit()` returns `Future[String]` (the runId). The actual Spark job
runs inside `Future { ... }` on a dedicated `ExecutionContext` backed by a cached thread pool,
not the Pekko dispatcher. This prevents blocking the Pekko HTTP thread pool.

### D4: PipelineRunCache — `concurrent.TrieMap`
A plain `scala.collection.concurrent.TrieMap[String, RunEntry]` is sufficient. No actor
indirection needed — the cache is read/written from background Futures and HTTP handler Futures;
`TrieMap` provides thread-safe puts/gets without locks.

### D5: Input data — fetch from DataSource before submitting
`SparkJobSubmitter` fetches the pipeline's source data via the existing `DataSourceRepository` /
`DataSource` domain, loads it into a Spark DataFrame (using `spark.createDataFrame`), then applies
steps in order. For the initial implementation, only `static` and `csv` source types need to be
supported; `rest_api` and `sql` can return a `400` "unsupported source type" error at submit time.

### D6: New route file `PipelineRunRoutes.scala`
Rather than extending the existing `PipelineRoutes`, add a new `PipelineRunRoutes` class that
takes `PipelineRepository`, `PipelineStepRepository`, `SparkJobSubmitter`, and `PipelineRunCache`
as constructor args. Wire it in `ApiRoutes`.

### D7: Step-config parsing
Each `PipelineStep.config` is a JSON blob. Parse it with Spray JSON inside `SparkJobSubmitter`
using a simple `JsValue` pattern match, consistent with the rest of the codebase.

## Risks / Trade-offs

- [Spark JAR size ~200 MB] → Acceptable per user decision; fat-jar build time increases significantly.
  Mitigation: document in CLAUDE.md; CI can cache `~/.ivy2`.
- [Akka conflict eviction warnings from sbt] → Add explicit `dependencyOverrides` for any
  `akka-*` versions that sbt cannot resolve cleanly.
- [SparkSession startup latency ~5-10s on first request] → Eager initialization at app startup
  (initialize in `Main.scala`) so the first `/run` call is not penalized.
- [Static/CSV-only source support] → Pipelines backed by `rest_api` or `sql` sources return
  `422 Unprocessable Entity` with a clear error message.
- [In-memory cache lost on restart] → Documented limitation; HEL-232 will address persistence.

## Planner Notes

- User confirmed: go straight to Spark, skip in-process engine. HEL-186 superseded.
- User confirmed: in-memory cache only; Iceberg follow-up is HEL-232.
- User confirmed: use `spark-core` / `spark-sql` compile-scope with Akka exclusions.
- No architectural escalation needed — change is additive, no breaking API changes.
