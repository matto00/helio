package com.helio.services

import com.helio.api.protocols.{PipelineRunRecord, RunResultResponse}
import com.helio.api.routes.{PipelineRunRegistry, RunStatusEvent}
import com.helio.domain.{
  DataField,
  DataSource,
  DataTypeId,
  InProcessPipelineEngine,
  Pipeline,
  PipelineId,
  PipelineRunId,
  PipelineStep,
  PipelineStepHandlers,
  RestSource,
  SqlSource
}
import com.helio.infrastructure.{
  DataSourceRepository,
  DataTypeRepository,
  DataTypeRowRepository,
  FileSystem,
  PipelineRepository,
  PipelineRunRepository,
  PipelineStepRepository
}
import com.helio.spark.PipelineRunCache
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Service-side run lifecycle. Extracted from the pre-CS2c-3a 380-line
 *  `PipelineRunRoutes` so HTTP routes become thin shells that translate
 *  service results into responses. */
final class PipelineRunService(
    pipelineRepo:     PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo:   DataSourceRepository,
    pipelineRunRepo:  PipelineRunRepository,
    dataTypeRepo:     DataTypeRepository,
    dataTypeRowRepo:  DataTypeRowRepository,
    cache:            PipelineRunCache,
    registry:         PipelineRunRegistry,
    fileSystem:       FileSystem
)(implicit ec: ExecutionContext) {

  private val engine = new InProcessPipelineEngine(fileSystem)

  /** Submit a run (or dry-run) and return its result. Owns pre-execution
   *  (insert run record + prune old runs), source-type dispatch, SSE event
   *  publication, and result fetch + serialization. */
  def submit(pipelineId: PipelineId, isDry: Boolean): Future[Either[ServiceError, RunResultResponse]] =
    pipelineRepo.findById(pipelineId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
      case Some(pipeline) =>
        dataSourceRepo.findById(pipeline.sourceDataSourceId).flatMap {
          case None =>
            Future.successful(Left(ServiceError.UnprocessableEntity(
              "DataSource not found: " + pipeline.sourceDataSourceId.value
            )))
          case Some(dataSource) =>
            dataSource match {
              case _: RestSource | _: SqlSource =>
                Future.successful(Left(ServiceError.UnprocessableEntity(
                  "Unsupported source type for Spark job submission: " +
                    dataSource.kind + ". Only static and csv are currently supported."
                )))
              case _ =>
                pipelineStepRepo
                  .listByPipeline(pipelineId)
                  .flatMap(steps => executeRun(pipeline, dataSource, steps, isDry))
            }
        }
    }

  /** Run only the prefix of `steps` ending at `stepId`, returning at most 10
   *  rows for the inline preview tray. */
  def previewStep(pipelineId: PipelineId, stepId: String): Future[Either[ServiceError, RunResultResponse]] =
    pipelineRepo.findById(pipelineId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
      case Some(pipeline) =>
        dataSourceRepo.findById(pipeline.sourceDataSourceId).flatMap {
          case None =>
            Future.successful(Left(ServiceError.UnprocessableEntity(
              "DataSource not found: " + pipeline.sourceDataSourceId.value
            )))
          case Some(dataSource) =>
            dataSource match {
              case _: RestSource | _: SqlSource =>
                Future.successful(Left(ServiceError.UnprocessableEntity(
                  "Unsupported source type for preview: " +
                    dataSource.kind + ". Only static and csv are currently supported."
                )))
              case _ =>
                pipelineStepRepo.listByPipeline(pipelineId).flatMap { allSteps =>
                  val sortedSteps = allSteps.sortBy(_.position)
                  sortedSteps.indexWhere(_.id.value == stepId) match {
                    case -1 =>
                      Future.successful(Left(ServiceError.NotFound("Step not found: " + stepId)))
                    case k =>
                      val slicedSteps = sortedSteps.take(k + 1)
                      engine.loadRows(dataSource, dataSourceRepo).flatMap { sourceRows =>
                        engine
                          .executeWithStepCounts(sourceRows, slicedSteps, dataSourceRepo)
                          .map { case (out, counts) =>
                            val allJsRows = out.map { rowMap =>
                              JsObject(rowMap.map { case (k, v) => k -> PipelineStepHandlers.anyToJsValue(v) })
                            }.toVector
                            val totalCount = allJsRows.size
                            val previewRows = allJsRows.take(10)
                            Right(RunResultResponse(previewRows, totalCount, counts, sourceRows.size.toLong))
                          }
                      }.recover { case ex =>
                        Left(ServiceError.UnprocessableEntity(
                          "Pipeline execution failed: " + Option(ex.getMessage).getOrElse(ex.getClass.getName)
                        ))
                      }
                  }
                }
            }
        }
    }

  /** Fetch the cached status of a run (queued/running/succeeded/failed). */
  def status(runId: String): Option[CachedRunStatus] =
    cache.get(runId).map { entry =>
      val rowsJson: Option[JsValue] = entry.rows.map { rows =>
        JsArray(rows.map { rowMap =>
          JsObject(rowMap.map { case (k, v) => k -> PipelineStepHandlers.anyToJsValue(v) })
        }.toVector)
      }
      val rowCount: Option[Int] = entry.rows.map(_.size)
      CachedRunStatus(entry.runId, entry.status, rowsJson, entry.error, rowCount)
    }

  /** Persisted run history for a pipeline. */
  def history(pipelineId: PipelineId): Future[Either[ServiceError, Vector[PipelineRunRecord]]] =
    if (pipelineRunRepo == null) Future.successful(Right(Vector.empty))
    else
      pipelineRepo.findById(pipelineId).flatMap {
        case None =>
          Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
        case Some(_) =>
          pipelineRunRepo.listByPipeline(pipelineId).map { rows =>
            Right(rows.map { r =>
              PipelineRunRecord(
                id          = r.id,
                pipelineId  = r.pipelineId,
                status      = r.status,
                startedAt   = r.startedAt.toString,
                completedAt = r.completedAt.map(_.toString),
                rowCount    = r.rowCount,
                errorLog    = r.errorLog
              )
            })
          }
      }

  /** SSE event stream (delegates to the registry). Routes wrap this into the
   *  `text/event-stream` HTTP response. */
  def eventRegistry: PipelineRunRegistry = registry

  /** Guard the SSE stream against a missing pipeline. */
  def pipelineExists(pipelineId: PipelineId): Future[Boolean] =
    pipelineRepo.findById(pipelineId).map(_.isDefined)

  // ── Internal helpers ──────────────────────────────────────────────────────

  private def publish(pipelineId: String, event: RunStatusEvent): Unit =
    if (registry != null) registry.publish(pipelineId, event)

  /** Pre-execute (insert run record + prune) → load source rows → run engine
   *  → publish SSE events → handle success/failure. Extracted from `submit`
   *  to flatten the nested flatMap chain. Behaviour-preserving. */
  private def executeRun(
      pipeline:   Pipeline,
      dataSource: DataSource,
      steps:      Vector[PipelineStep],
      isDry:      Boolean
  ): Future[Either[ServiceError, RunResultResponse]] = {
    val pipelineId = pipeline.id
    val runId      = PipelineRunId(UUID.randomUUID().toString)
    val startAt    = Instant.now()
    val pidStr     = pipelineId.value

    publish(pidStr, RunStatusEvent("queued"))

    val preExec: Future[Unit] =
      if (!isDry && pipelineRunRepo != null)
        pipelineRunRepo
          .insertRun(runId, pipelineId, startAt)
          .flatMap(_ => pipelineRunRepo.deleteOldRuns(pipelineId, keepN = 10))
          .recoverWith { case _ => Future.successful(()) }
      else Future.successful(())

    publish(pidStr, RunStatusEvent("running"))

    val runFuture = preExec.flatMap { _ =>
      engine.loadRows(dataSource, dataSourceRepo).flatMap { sourceRows =>
        engine
          .executeWithStepCounts(sourceRows, steps, dataSourceRepo)
          .map { case (out, counts) => (out, counts, sourceRows.size.toLong) }
      }
    }

    runFuture.transformWith {
      case Failure(ex) =>
        val errMsg = "Pipeline execution failed: " +
          Option(ex.getMessage).getOrElse(ex.getClass.getName)
        publish(pidStr, RunStatusEvent("failed", errorLog = Some(errMsg)))
        val failWork: Future[Unit] =
          if (!isDry) {
            val updateRun =
              if (pipelineRunRepo != null)
                pipelineRunRepo.updateRunTerminal(runId, "failed", Instant.now(), errorLog = Some(errMsg))
              else Future.successful(())
            updateRun.flatMap { _ =>
              pipelineRepo.updateLastRun(pipelineId, "failed", Instant.now(), rowCount = None)
            }.map(_ => ())
          } else Future.successful(())
        failWork.map(_ => Left(ServiceError.UnprocessableEntity(errMsg)))

      case Success((resultRows, stepCounts, sourceCount)) =>
        val jsRows = resultRows.map { rowMap =>
          JsObject(rowMap.map { case (k, v) => k -> PipelineStepHandlers.anyToJsValue(v) })
        }.toVector
        val response = RunResultResponse(jsRows, jsRows.size, stepCounts, sourceCount)
        val followUp: Future[Unit] =
          if (isDry) onDryRunSuccess(pipelineId, runId, startAt, pidStr, resultRows.size)
          else onRunSuccess(pipeline.outputDataTypeId, pipelineId, runId, pidStr, resultRows, jsRows)
        followUp.map(_ => Right(response))
    }
  }

  private def onDryRunSuccess(
      pipelineId: PipelineId,
      runId:      PipelineRunId,
      startAt:    Instant,
      pidStr:     String,
      rowCount:   Int
  ): Future[Unit] = {
    publish(pidStr, RunStatusEvent("dry_run", rowCount = Some(rowCount)))
    if (pipelineRunRepo != null)
      pipelineRunRepo
        .insertDryRun(runId, pipelineId, startAt, rowCount)
        .flatMap(_ => pipelineRunRepo.deleteOldDryRuns(pipelineId))
        .recoverWith { case _ => Future.successful(()) }
        .map(_ => ())
    else Future.successful(())
  }

  private def onRunSuccess(
      outputDataTypeId: DataTypeId,
      pipelineId:       PipelineId,
      runId:            PipelineRunId,
      pidStr:           String,
      resultRows:       Seq[Map[String, Any]],
      jsRows:           Vector[JsObject]
  ): Future[Unit] = {
    publish(pidStr, RunStatusEvent("succeeded", rowCount = Some(resultRows.size)))
    val now = Instant.now()
    val schemaUpsert =
      if (dataTypeRepo != null) upsertFieldsFromRows(outputDataTypeId, resultRows)
      else Future.successful(())
    val rowsUpsert =
      if (dataTypeRowRepo != null) dataTypeRowRepo.overwriteRows(outputDataTypeId.value, jsRows).map(_ => ())
      else Future.successful(())
    val updateMeta = pipelineRepo.updateLastRun(pipelineId, "succeeded", now, rowCount = Some(resultRows.size.toLong)).map(_ => ())
    val updateRun =
      if (pipelineRunRepo != null)
        pipelineRunRepo.updateRunTerminal(runId, "succeeded", now, rowCount = Some(resultRows.size)).map(_ => ())
      else Future.successful(())
    for {
      _ <- schemaUpsert
      _ <- rowsUpsert
      _ <- updateMeta
      _ <- updateRun
    } yield ()
  }

  // Infer field type strings from row values. Whole-number Doubles → "integer",
  // fractional Doubles → "double" (jsValueToAny always produces Double).
  private def inferFieldType(value: Any): String = value match {
    case _: Boolean => "boolean"
    case _: Int | _: Long => "integer"
    case d: Double if !d.isNaN && !d.isInfinite && d % 1.0 == 0.0 => "integer"
    case _: Float | _: Double => "double"
    case _ => "string"
  }

  private def upsertFieldsFromRows(
      dataTypeId: DataTypeId,
      rows:       Seq[Map[String, Any]]
  ): Future[Unit] = {
    if (dataTypeRepo == null) return Future.successful(())
    val firstRow = rows.headOption.getOrElse(Map.empty)
    val fields = firstRow.keys.toVector.map { name =>
      DataField(name, name, inferFieldType(firstRow.get(name).orNull), nullable = true)
    }
    dataTypeRepo.findById(dataTypeId).flatMap {
      case None => Future.successful(())
      case Some(existing) =>
        dataTypeRepo.update(existing.copy(fields = fields, updatedAt = Instant.now())).map(_ => ())
    }
  }

}

/** Service-side projection of a cached run's status. Translated by routes
 *  into the `RunStatusResponse` wire shape. */
final case class CachedRunStatus(
    runId:    String,
    status:   String,
    rows:     Option[JsValue],
    error:    Option[String],
    rowCount: Option[Int]
)
