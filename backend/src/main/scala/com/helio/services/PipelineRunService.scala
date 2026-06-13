package com.helio.services

import com.helio.api.protocols.{PipelineRunRecord, RunResultResponse}
import com.helio.api.routes.{PipelineRunRegistry, RunStatusEvent}
import com.helio.domain.{
  AuthenticatedUser,
  DataField,
  DataSource,
  DataTypeId,
  InProcessPipelineEngine,
  Pipeline,
  PipelineId,
  PipelineRowJson,
  PipelineRunId,
  PipelineStep,
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
   *  publication, and result fetch + serialization.
   *
   *  HEL-279: sharing-aware. Owner and editor grantees can submit runs;
   *  viewer grantees receive 403 (resource visible, mutation blocked).
   *  The source lookup uses `DataSourceRepository.findByIdInternal` (privileged)
   *  because the pipeline could legitimately reference a join-target source the
   *  caller does not own; the pipeline ACL gated entry. */
  def submit(pipelineId: PipelineId, isDry: Boolean, user: AuthenticatedUser): Future[Either[ServiceError, RunResultResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
      case Some(pipeline) if pipeline.ownerId.value != user.id.value =>
        // Grantee — only editor grantees may trigger runs; viewers get 403.
        pipelineRepo.findGrantRole(pipelineId, user).flatMap {
          case Some("editor") => runPipeline(pipeline, pipelineId, isDry, user)
          case _              => Future.successful(Left(ServiceError.Forbidden("Forbidden")))
        }
      case Some(pipeline) =>
        // Owner path — always permitted.
        runPipeline(pipeline, pipelineId, isDry, user)
    }

  private def runPipeline(pipeline: Pipeline, pipelineId: PipelineId, isDry: Boolean, user: AuthenticatedUser): Future[Either[ServiceError, RunResultResponse]] =
    // Privileged: pipeline ACL is the authoritative gate; source is part of the
    // pipeline definition. findByIdInternal is correct here.
    dataSourceRepo.findByIdInternal(pipeline.sourceDataSourceId).flatMap {
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
            // Safe: pipeline ACL confirmed by findByIdShared. Use internal step list
            // so editor grantees (not pipeline owners) are not blocked by V35 RLS.
            pipelineStepRepo
              .listByPipelineInternal(pipelineId)
              .flatMap(steps => executeRun(pipeline, dataSource, steps, isDry, user))
        }
    }

  /** Run only the prefix of `steps` ending at `stepId`, returning at most 10
   *  rows for the inline preview tray.
   *  HEL-279: sharing-aware — owner and grantees can preview. */
  def previewStep(pipelineId: PipelineId, stepId: String, user: AuthenticatedUser): Future[Either[ServiceError, RunResultResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
      case Some(pipeline) =>
        // Privileged: pipeline ACL is the authoritative gate. findByIdInternal is correct here.
        dataSourceRepo.findByIdInternal(pipeline.sourceDataSourceId).flatMap {
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
                // Safe: pipeline ACL confirmed by findByIdShared. Use internal step list.
                pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
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
                              JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
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
          JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
        }.toVector)
      }
      val rowCount: Option[Int] = entry.rows.map(_.size)
      CachedRunStatus(entry.runId, entry.status, rowsJson, entry.error, rowCount)
    }

  /** Persisted run history for a pipeline.
   *  HEL-279: sharing-aware — owner, editor, and viewer grantees can read history. */
  def history(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineRunRecord]]] =
    if (pipelineRunRepo == null) Future.successful(Right(Vector.empty))
    else
      pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
        case None =>
          Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
        case Some(_) =>
          // Safe: access confirmed by findByIdShared. Use system context to bypass the
          // V35 pipeline_runs RLS owner-JOIN so grantees can read run records.
          pipelineRunRepo.listByPipelineInternal(pipelineId).map { rows =>
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

  /** Owner-scoped existence check used by the SSE stream guard. */
  def pipelineExists(pipelineId: PipelineId, user: AuthenticatedUser): Future[Boolean] =
    pipelineRepo.findById(pipelineId, user).map(_.isDefined)

  /** Sharing-aware existence check. Returns true for owner AND grantees (editor/viewer).
   *  Used by SSE, run-history, and run-submit routes so viewer grantees can subscribe
   *  and see history. No public-viewer (anonymous) path for pipelines. */
  def pipelineExistsShared(pipelineId: PipelineId, user: AuthenticatedUser): Future[Boolean] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).map(_.isDefined)

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
      isDry:      Boolean,
      user:       AuthenticatedUser
  ): Future[Either[ServiceError, RunResultResponse]] = {
    val pipelineId = pipeline.id
    val runId      = PipelineRunId(UUID.randomUUID().toString)
    val startAt    = Instant.now()
    val pidStr     = pipelineId.value

    publish(pidStr, RunStatusEvent("queued"))

    val preExec: Future[Unit] =
      if (!isDry && pipelineRunRepo != null)
        pipelineRunRepo
          .insertRun(runId, pipelineId, startAt, user)
          .flatMap(_ => pipelineRunRepo.deleteOldRuns(pipelineId, user, keepN = 10))
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
                pipelineRunRepo.updateRunTerminal(runId, "failed", Instant.now(), rowCount = None, errorLog = Some(errMsg), user)
              else Future.successful(())
            updateRun.flatMap { _ =>
              pipelineRepo.updateLastRun(pipelineId, "failed", Instant.now(), rowCount = None, user)
            }.map(_ => ())
          } else Future.successful(())
        failWork.map(_ => Left(ServiceError.UnprocessableEntity(errMsg)))

      case Success((resultRows, stepCounts, sourceCount)) =>
        val jsRows = resultRows.map { rowMap =>
          JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
        }.toVector
        val response = RunResultResponse(jsRows, jsRows.size, stepCounts, sourceCount)
        val followUp: Future[Unit] =
          if (isDry) onDryRunSuccess(pipelineId, runId, startAt, pidStr, resultRows.size, user)
          else onRunSuccess(pipeline.outputDataTypeId, pipelineId, runId, pidStr, resultRows, jsRows, user)
        followUp.map(_ => Right(response))
    }
  }

  private def onDryRunSuccess(
      pipelineId: PipelineId,
      runId:      PipelineRunId,
      startAt:    Instant,
      pidStr:     String,
      rowCount:   Int,
      user:       AuthenticatedUser
  ): Future[Unit] = {
    publish(pidStr, RunStatusEvent("dry_run", rowCount = Some(rowCount)))
    if (pipelineRunRepo != null)
      pipelineRunRepo
        .insertDryRun(runId, pipelineId, startAt, rowCount, user)
        .flatMap(_ => pipelineRunRepo.deleteOldDryRuns(pipelineId, user))
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
      jsRows:           Vector[JsObject],
      user:             AuthenticatedUser
  ): Future[Unit] = {
    publish(pidStr, RunStatusEvent("succeeded", rowCount = Some(resultRows.size)))
    val now = Instant.now()
    val schemaUpsert =
      if (dataTypeRepo != null) upsertFieldsFromRows(outputDataTypeId, resultRows)
      else Future.successful(())
    val rowsUpsert =
      if (dataTypeRowRepo != null) dataTypeRowRepo.overwriteRows(outputDataTypeId.value, jsRows).map(_ => ())
      else Future.successful(())
    val updateMeta = pipelineRepo.updateLastRun(pipelineId, "succeeded", now, rowCount = Some(resultRows.size.toLong), user).map(_ => ())
    val updateRun =
      if (pipelineRunRepo != null)
        pipelineRunRepo.updateRunTerminal(runId, "succeeded", now, rowCount = Some(resultRows.size), errorLog = None, user).map(_ => ())
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
    // Privileged: this is a background post-run schema sync. The pipeline ACL
    // was the gate at submission time; no user context is available here.
    // Uses updateInternal (withSystemContext) to bypass the V35 RLS policy on
    // data_types — correct because this path runs without a request-bound user.
    dataTypeRepo.findByIdInternal(dataTypeId).flatMap {
      case None => Future.successful(())
      case Some(existing) =>
        dataTypeRepo.updateInternal(existing.copy(fields = fields, updatedAt = Instant.now())).map(_ => ())
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
