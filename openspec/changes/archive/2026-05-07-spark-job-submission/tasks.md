## 1. Backend — Dependencies

- [x] 1.1 Add `spark-core` and `spark-sql` 3.5.5 to `backend/build.sbt` with Akka/Pekko and slf4j/log4j exclusions
- [x] 1.2 Add `dependencyOverrides` in `build.sbt` for any Akka artifacts that still surface after exclusions
- [x] 1.3 Verify `sbt evicted` shows no critical evictions for `pekko-*` or `akka-*`

## 2. Backend — PipelineRunCache

- [x] 2.1 Create `backend/src/main/scala/com/helio/spark/PipelineRunCache.scala` with `RunEntry` case class (`runId`, `status`, `rows`, `error`) and `TrieMap`-backed thread-safe store
- [x] 2.2 Implement `put(runId, status)`, `update(runId, status, rows, error)`, and `get(runId): Option[RunEntry]` methods

## 3. Backend — SparkJobSubmitter

- [x] 3.1 Create `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` with a lazy `SparkSession` initialized from `application.conf` `spark.masterUrl`
- [x] 3.2 Implement `submit(pipeline, dataSource, steps, cache): Future[String]` that generates a runId, stores `queued` in cache, and runs the job on a dedicated `ExecutionContext`
- [x] 3.3 Implement loading source data into a Spark DataFrame for `static` source type (parse JSON array from DataSource config)
- [x] 3.4 Implement loading source data into a Spark DataFrame for `csv` source type (read CSV file path from DataSource config)
- [x] 3.5 Return `422`-triggering `Left("unsupported source type")` for `rest_api` and `sql` source types
- [x] 3.6 Implement `applyStep` for `rename` op (withColumnRenamed for each mapping entry)
- [x] 3.7 Implement `applyStep` for `filter` op (DataFrame.filter with SQL expression)
- [x] 3.8 Implement `applyStep` for `compute` op (withColumn + expr)
- [x] 3.9 Implement `applyStep` for `groupby` op (groupBy + agg with supported functions: sum, count, avg, min, max)
- [x] 3.10 Implement `applyStep` for `cast` op (withColumn + col.cast)
- [x] 3.11 Implement `applyStep` for `join` op (read target DataFrame from cache or DataTypeRepository, inner join on joinKey)
- [x] 3.12 Update cache to `running` when job starts, `succeeded` + rows on completion, `failed` + error on exception
- [x] 3.13 Serialize result DataFrame rows to `Seq[Map[String, Any]]` (collect + Row.getValuesMap)

## 4. Backend — HTTP Routes

- [x] 4.1 Create `backend/src/main/scala/com/helio/api/routes/PipelineRunRoutes.scala` with constructor args `(pipelineRepo, pipelineStepRepo, dataSourceRepo, submitter, cache, user)`
- [x] 4.2 Implement `POST /api/pipelines/:id/run` route: validate pipeline exists, check source type, call submitter, return `201 { runId }`
- [x] 4.3 Implement `GET /api/pipelines/:id/runs/:runId` route: look up cache, return `200` with status/rows/error or `404`
- [x] 4.4 Add `RunSubmitResponse` and `RunStatusResponse` case classes to `JsonProtocols.scala` with Spray JSON formatters
- [x] 4.5 Instantiate `PipelineRunCache` and `SparkJobSubmitter` in `Main.scala` (or `HttpServer.scala`) and pass to `ApiRoutes`
- [x] 4.6 Add `PipelineRunRoutes` constructor parameter to `ApiRoutes` and register its routes in the authenticated route block

## 5. Tests

- [x] 5.1 Create `backend/src/test/scala/com/helio/spark/PipelineRunCacheSpec.scala` with unit tests for all cache operations (put, update, get, missing key)
- [x] 5.2 Create `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` using Spark local mode (`master("local")`) — test each step op with small DataFrames
- [x] 5.3 Create `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` with Pekko HTTP testkit — mock submitter, test 201/404/422 for POST and 200/404 for GET
- [x] 5.4 Run `sbt test` and verify all tests pass
- [x] 5.5 Run `npm test` and verify no frontend regressions
