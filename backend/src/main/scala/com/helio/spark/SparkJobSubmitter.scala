package com.helio.spark

import com.helio.domain.{AggregateStep, CastStep, ComputeStep, FilterStep, GroupByStep, JoinStep, LimitStep, RenameStep, SelectStep, SortStep}
import com.helio.domain.steps.SecondaryInput
import com.helio.domain.engine.{NodeKey, PipelineExecutionBackend, PipelineExecutionOutcome, SourceReadStats}
import com.helio.domain.model.{AssertionSink, CsvSource, DataSource, DataSourceId, Pipeline, PipelineRunId, PipelineStep, StaticSource, TruncationSink}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository.parseStaticPayload
import com.helio.services.pipelines.TriggerSource
import org.apache.spark.sql.{DataFrame, Row, SparkSession, functions => F}
import org.apache.spark.sql.types._
import org.slf4j.LoggerFactory
import spray.json.{DefaultJsonProtocol, JsArray, JsBoolean, JsNull, JsNumber, JsObject, JsString, JsValue}
import DefaultJsonProtocol._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future, blocking}

class SparkJobSubmitter(
    masterUrl: String,
    dataSourceRepo: DataSourceRepository,
    pipelineRepo: PipelineRepository,
    pipelineRunRepo: PipelineRunRepository = null
)(implicit ec: ExecutionContext)
    extends PipelineExecutionBackend {

  private val log = LoggerFactory.getLogger(getClass)

  private val sparkEc: ExecutionContext =
    ExecutionContext.fromExecutorService(Executors.newCachedThreadPool())

  private[spark] lazy val spark: SparkSession =
    SparkSession
      .builder()
      .appName("helio-pipeline-driver")
      .master(masterUrl)
      .config("spark.ui.enabled", "false")
      .config("spark.sql.shuffle.partitions", "4")
      .config("spark.default.parallelism", "4")
      .getOrCreate()

  def initialize(): SparkSession = spark

  def submit(
      pipeline: Pipeline,
      dataSource: DataSource,
      steps: Seq[PipelineStep],
      cache: PipelineRunCache
  ): Future[String] = {
    val runIdStr  = UUID.randomUUID().toString
    val runId     = PipelineRunId(runIdStr)
    val startedAt = Instant.now()
    cache.put(runIdStr, RunStatus.Queued)

    // HEL-265 CS2: the background Spark driver runs outside the request-bound
    // user context. The pipeline ACL was already checked at submit time by
    // `PipelineRunService.submit` (owner-scoped `pipelineRepo.findById`);
    // these post-execution writes use the explicit `*Internal` variants the
    // repos expose for this exact privileged-driver use case.
    // HEL-417: this path has no caller in the route tree yet (HEL-202,
    // dormant) and carries no `triggerSource` parameter of its own; default
    // to manual so it stays consistent with PipelineRunService.submit's
    // default until HEL-202 wires a real callsite (and threads a
    // triggerSource through if a scheduler ever targets the Spark path).
    if (pipelineRunRepo != null) {
      pipelineRunRepo.insertRunInternal(runId, pipeline.id, startedAt, TriggerSource.Manual)
      pipelineRunRepo.deleteOldRunsInternal(pipeline.id)
    }

    Future {
      blocking {
        cache.update(runIdStr, RunStatus.Running)
        try {
          val df       = loadDataFrame(dataSource)
          val resultDf = steps.foldLeft(df)((cur, step) => applyStep(cur, step))
          val rows     = collectRows(resultDf)
          val now      = Instant.now()
          cache.update(runIdStr, RunStatus.Succeeded, rows = Some(rows))
          pipelineRepo.updateLastRunInternal(pipeline.id, RunStatus.Succeeded, now)
          if (pipelineRunRepo != null) {
            pipelineRunRepo.updateRunTerminalInternal(runId, RunStatus.Succeeded, now, rowCount = Some(rows.size))
          }
        } catch {
          case ex: Throwable =>
            // HEL-311: this `errorMsg` fans out to the same client-visible
            // surfaces as the in-process engine's run-failure path
            // (`PipelineRunService.executeRun`) — cache `error` (surfaced via
            // `RunStatusResponse.error`) and the persisted run record's
            // `errorLog`. Keep the static prefix, log the raw cause
            // server-side, never echo it to the client.
            val now      = Instant.now()
            log.error(s"Spark pipeline job failed for pipeline ${pipeline.id.value}, run $runIdStr", ex)
            val errorMsg = "Pipeline execution failed"
            cache.update(runIdStr, RunStatus.Failed, error = Some(errorMsg))
            pipelineRepo.updateLastRunInternal(pipeline.id, RunStatus.Failed, now)
            if (pipelineRunRepo != null) {
              pipelineRunRepo.updateRunTerminalInternal(runId, RunStatus.Failed, now, errorLog = Some(errorMsg))
            }
        }
      }
    }(sparkEc)

    Future.successful(runIdStr)
  }

  /** HEL-330 (design.md Decision 2): an additive `execute`, bypassing `submit`/`PipelineRunCache`
   *  entirely -- a direct synchronous composition of `loadDataFrame`/`applyStep`/`collectRows`,
   *  mirroring `submit`'s own body but returning the outcome instead of writing it to a cache.
   *  This performs no `pipelineRunRepo`/`pipelineRepo` writes and does not touch `cache` -- it
   *  does not reproduce `submit`'s side-effecting persistence, which remains `submit`'s job,
   *  unchanged, for its own dormant callers. `assertionSink`/`truncationSink` are accepted per
   *  the trait contract and silently ignored -- the Spark path supports neither `assert` steps
   *  nor truncation tracking. `stepCounts`/`sourceRowCount` (pre-step)/`primaryStats` (always
   *  untruncated) are documented approximations (design.md Risks/Trade-offs): this path has zero
   *  production callers today and exists solely to demonstrate the trait admits a second impl. */
  /** HEL-913 (design.md task 5.6): the trait's `roots` parameter is accepted here so the
   *  contract still compiles for Spark, but this path uses ONLY `roots.head` (the lowest-
   *  positioned root) -- implementing the actual multi-root walk on Spark stays HEL-238's job,
   *  unchanged in scope by this ticket (design.md explicitly rules this out of scope here). This
   *  is a documented approximation, not a silent one: a Spark-backed pipeline with more than one
   *  root would silently ignore every root but the first, same "zero production callers today"
   *  caveat the rest of this method's header already states. */
  def execute(
      pipeline: Pipeline,
      roots: Vector[(String, DataSource)],
      steps: Vector[PipelineStep],
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink,
      truncationSink: TruncationSink,
      // HEL-905 (design.md Decision 6): no per-node concept in the Spark path -- accepted per
      // the trait contract and never invoked, same "leave untouched" convention as
      // assertionSink/truncationSink above.
      onNodeProgress: (NodeKey, Long) => Unit
  )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] =
    Future {
      val dataSource = roots.head._2
      val df       = loadDataFrame(dataSource)
      val resultDf = steps.foldLeft(df)((cur, step) => applyStep(cur, step))
      val rows     = collectRows(resultDf)
      PipelineExecutionOutcome(
        rows = rows,
        stepCounts = Map.empty,
        sourceRowCount = df.count(),
        primaryStats = SourceReadStats(truncated = false, availableRowCount = None)
      )
    }(sparkEc)

  private[spark] def loadDataFrame(ds: DataSource): DataFrame = ds match {
    case s: StaticSource =>
      val raw =
        if (dataSourceRepo != null)
          Await.result(dataSourceRepo.readRawConfig(s.id), 30.seconds).getOrElse("{}")
        else "{}"
      val obj     = parseStaticPayload(raw)
      val columns = obj.fields.getOrElse("columns", JsArray.empty).convertTo[Vector[JsObject]]
      val rows    = obj.fields.getOrElse("rows", JsArray.empty).convertTo[Vector[Vector[JsValue]]]

      val schema = StructType(columns.map { col =>
        StructField(
          name     = col.fields("name").convertTo[String],
          dataType = sparkDataType(col.fields("type").convertTo[String]),
          nullable = true
        )
      })

      val sparkRows = rows.map { row =>
        Row.fromSeq(row.zip(schema.fields).map { case (v, field) =>
          jsValueToAny(v, field.dataType)
        })
      }

      spark.createDataFrame(spark.sparkContext.parallelize(sparkRows.toList), schema)

    case c: CsvSource =>
      if (c.config.path.isEmpty)
        throw new IllegalArgumentException(
          s"CSV data source '${c.name}' (id=${c.id.value}) is missing required config key 'path'"
        )
      spark.read
        .option("header", "true")
        .option("inferSchema", "true")
        .csv(c.config.path)

    case other =>
      throw new IllegalArgumentException(
        s"Unsupported source type for Spark job submission: ${other.kind}. " +
          "Only 'static' and 'csv' are currently supported."
      )
  }

  /** Sealed-trait dispatch — same coverage shape as the in-process engine's
   *  `applyStep`. The Spark side currently supports a subset of ops
   *  (Aggregate / Select / Limit / Sort don't have Spark handlers today).
   *  Adding them without throwing here keeps the door open for HEL-202;
   *  for now the unsupported cases fail explicitly. */
  private[spark] def applyStep(df: DataFrame, step: PipelineStep): DataFrame = step match {
    case s: RenameStep =>
      s.config.renames.foldLeft(df) { case (d, (from, to)) => d.withColumnRenamed(from, to) }

    case s: FilterStep =>
      // Spark filter uses a single SQL expression (existing wire shape via
      // the pre-CS2c-3a engine read it as `expression`). We synthesize the
      // expression from the typed conditions: AND/OR over `field op value`.
      val combinator = s.config.combinator.toUpperCase
      val parts = s.config.conditions.collect {
        case c if c.field.nonEmpty =>
          val v = c.value.getOrElse("")
          c.operator match {
            case "is null"     => s"`${c.field}` IS NULL"
            case "is not null" => s"`${c.field}` IS NOT NULL"
            case "contains"    => s"`${c.field}` LIKE '%${v.replace("'", "''")}%'"
            case op            => s"`${c.field}` $op '${v.replace("'", "''")}'"
          }
      }
      if (parts.isEmpty) df
      else df.filter(parts.mkString(s" $combinator "))

    case s: ComputeStep =>
      df.withColumn(s.config.column, F.expr(s.config.expression))

    case s: GroupByStep =>
      val cfg    = s.config
      val aggCol = cfg.aggColumn
      val aggFn  = cfg.aggFunction.toLowerCase
      val aggExpr = aggFn match {
        case "sum"   => F.sum(aggCol)
        case "count" => F.count(aggCol)
        case "avg"   => F.avg(aggCol)
        case "min"   => F.min(aggCol)
        case "max"   => F.max(aggCol)
        case other =>
          throw new IllegalArgumentException(
            s"Unsupported aggregation function: $other. Supported: sum, count, avg, min, max"
          )
      }
      df.groupBy(cfg.groupBy.head, cfg.groupBy.tail: _*).agg(aggExpr.as(s"${aggFn}_$aggCol"))

    case s: CastStep =>
      s.config.casts.foldLeft(df) { case (d, (col, dt)) =>
        d.withColumn(col, d(col).cast(sparkDataType(dt)))
      }

    case s: JoinStep =>
      // HEL-911 (design.md Engine contract item 5, task 9.2): `secondaryInput` replaces
      // the flat `rightDataSourceId` field. Only `source`-kind is supported here --
      // implementing the multi-lane walk (`lane`-kind resolution) on Spark stays with
      // HEL-238; a `lane` reference fails loudly rather than being silently mis-serialized.
      s.config.secondaryInput match {
        case SecondaryInput.Source(rightDsId) =>
          // Privileged: Spark batch driver runs outside request context; pipeline ACL
          // gated submission. findByIdInternal is correct for the background path.
          val rightDs = Await
            .result(dataSourceRepo.findByIdInternal(DataSourceId(rightDsId)), 30.seconds)
            .getOrElse(throw new IllegalArgumentException(s"DataSource not found for join: $rightDsId"))
          val rightDf = loadDataFrame(rightDs)
          df.join(rightDf, Seq(s.config.joinKey), if (s.config.joinType.toLowerCase == "left") "left" else "inner")
        case SecondaryInput.Lane(stepId) =>
          throw new IllegalArgumentException(
            s"join step '${s.id.value}': lane-kind secondaryInput (referencing '$stepId') is not " +
              "yet supported on the Spark execution path (HEL-238). Run via the in-process engine."
          )
      }

    case _: SelectStep | _: LimitStep | _: SortStep | _: AggregateStep =>
      throw new IllegalArgumentException(
        s"Step type '${step.kind}' is not yet supported on the Spark execution path. " +
          "Run via the in-process engine."
      )
  }

  private[spark] def collectRows(df: DataFrame): Seq[Map[String, Any]] = {
    val fieldNames = df.schema.fieldNames.toSeq
    df.collect().map(row => row.getValuesMap[Any](fieldNames)).toSeq
  }

  private def sparkDataType(s: String): DataType = s match {
    case "string"    => StringType
    case "integer"   => IntegerType
    case "long"      => LongType
    case "float"     => FloatType
    case "double"    => DoubleType
    case "boolean"   => BooleanType
    case "timestamp" => TimestampType
    case _           => StringType
  }

  private def jsValueToAny(v: JsValue, dt: DataType): Any = (v, dt) match {
    case (JsNull, _)                => null
    case (JsBoolean(b), _)          => b
    case (JsNumber(n), IntegerType) => n.toInt
    case (JsNumber(n), LongType)    => n.toLong
    case (JsNumber(n), FloatType)   => n.toFloat
    case (JsNumber(n), DoubleType)  => n.toDouble
    case (JsNumber(n), _)           => n.toDouble
    case (JsString(s), _)           => s
    case _                          => v.toString
  }
}
