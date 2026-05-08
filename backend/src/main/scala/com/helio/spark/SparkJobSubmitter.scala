package com.helio.spark

import com.helio.domain.{DataSource, DataSourceId, Pipeline, SourceType}
import com.helio.infrastructure.{DataSourceRepository, PipelineRepository, PipelineStepRepository}
import org.apache.spark.sql.{DataFrame, Row, SparkSession, functions => F}
import org.apache.spark.sql.types._
import spray.json.{DefaultJsonProtocol, JsArray, JsBoolean, JsNull, JsNumber, JsObject, JsString, JsValue, JsonParser}
import DefaultJsonProtocol._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future, blocking}

class SparkJobSubmitter(
    masterUrl: String,
    dataSourceRepo: DataSourceRepository,
    pipelineRepo: PipelineRepository
)(implicit ec: ExecutionContext) {

  private val sparkEc: ExecutionContext =
    ExecutionContext.fromExecutorService(Executors.newCachedThreadPool())

  private[spark] lazy val spark: SparkSession =
    SparkSession
      .builder()
      .appName("helio-pipeline-driver")
      .master(masterUrl)
      .config("spark.ui.enabled", "false")
      .config("spark.sql.shuffle.partitions", "4")
      .getOrCreate()

  def initialize(): SparkSession = spark

  def submit(
      pipeline: Pipeline,
      dataSource: DataSource,
      steps: Seq[PipelineStepRepository.PipelineStepRow],
      cache: PipelineRunCache
  ): Future[String] = {
    val runId = UUID.randomUUID().toString
    cache.put(runId, RunStatus.Queued)

    Future {
      blocking {
        cache.update(runId, RunStatus.Running)
        try {
          val df       = loadDataFrame(dataSource)
          val resultDf = steps.foldLeft(df)((cur, step) => applyStep(cur, step))
          val rows     = collectRows(resultDf)
          val now      = Instant.now()
          cache.update(runId, RunStatus.Succeeded, rows = Some(rows))
          pipelineRepo.updateLastRun(pipeline.id.value, RunStatus.Succeeded, now)
        } catch {
          case ex: Throwable =>
            val now = Instant.now()
            cache.update(
              runId,
              RunStatus.Failed,
              error = Some(Option(ex.getMessage).getOrElse(ex.getClass.getName))
            )
            pipelineRepo.updateLastRun(pipeline.id.value, RunStatus.Failed, now)
        }
      }
    }(sparkEc)

    Future.successful(runId)
  }

  private[spark] def loadDataFrame(ds: DataSource): DataFrame = ds.sourceType match {
    case SourceType.Static =>
      val obj     = ds.config.asJsObject
      val columns = obj.fields("columns").convertTo[Vector[JsObject]]
      val rows    = obj.fields("rows").convertTo[Vector[Vector[JsValue]]]

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

      spark.createDataFrame(
        spark.sparkContext.parallelize(sparkRows.toList),
        schema
      )

    case SourceType.Csv =>
      val filePath = ds.config.asJsObject.fields("filePath").convertTo[String]
      spark.read
        .option("header", "true")
        .option("inferSchema", "true")
        .csv(filePath)

    case other =>
      throw new IllegalArgumentException(
        s"Unsupported source type for Spark job submission: ${SourceType.asString(other)}. " +
          "Only 'static' and 'csv' are currently supported."
      )
  }

  private[spark] def applyStep(
      df: DataFrame,
      step: PipelineStepRepository.PipelineStepRow
  ): DataFrame = {
    val cfg = JsonParser(step.config).asJsObject

    step.op match {
      case "rename" =>
        val mappings = cfg.fields("mappings").convertTo[Vector[JsObject]]
        mappings.foldLeft(df) { (d, m) =>
          d.withColumnRenamed(
            m.fields("from").convertTo[String],
            m.fields("to").convertTo[String]
          )
        }

      case "filter" =>
        df.filter(cfg.fields("expression").convertTo[String])

      case "compute" =>
        val column     = cfg.fields("column").convertTo[String]
        val expression = cfg.fields("expression").convertTo[String]
        df.withColumn(column, F.expr(expression))

      case "groupby" =>
        val groupCols = cfg.fields("groupBy").convertTo[Vector[String]]
        val aggCol    = cfg.fields("aggColumn").convertTo[String]
        val aggFn     = cfg.fields("aggFunction").convertTo[String].toLowerCase

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
        df.groupBy(groupCols.head, groupCols.tail: _*).agg(aggExpr.as(s"${aggFn}_$aggCol"))

      case "cast" =>
        val column   = cfg.fields("column").convertTo[String]
        val dataType = cfg.fields("dataType").convertTo[String]
        df.withColumn(column, df(column).cast(sparkDataType(dataType)))

      case "join" =>
        val rightDsId = cfg.fields("rightDataSourceId").convertTo[String]
        val joinKey   = cfg.fields("joinKey").convertTo[String]
        val rightDs = Await
          .result(dataSourceRepo.findById(DataSourceId(rightDsId)), 30.seconds)
          .getOrElse(
            throw new IllegalArgumentException(s"DataSource not found for join: $rightDsId")
          )
        val rightDf = loadDataFrame(rightDs)
        df.join(rightDf, Seq(joinKey), "inner")

      case other =>
        throw new IllegalArgumentException(s"Unknown step op: $other")
    }
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
