package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols, PipelineRunRecord, RunResultResponse, RunStatusResponse, RunSubmitResponse}
import com.helio.domain.{AuthenticatedUser, DataField, DataTypeId, InProcessPipelineEngine, SourceType}
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.spark.{PipelineRunCache, RunStatus, SparkJobSubmitter}
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

class PipelineRunRoutes(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    submitter: SparkJobSubmitter,
    cache: PipelineRunCache,
    user: AuthenticatedUser,
    pipelineRunRepo: PipelineRunRepository = null,
    dataTypeRepo: DataTypeRepository = null
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  private val inProcessEngine = new InProcessPipelineEngine()

  val routes: Route =
    pathPrefix("pipelines" / Segment) { pipelineId =>
      concat(
        // POST /api/pipelines/:id/run[?dry=true]
        path("run") {
          post {
            parameter("dry".?) { dryParam =>
              val isDry = dryParam.contains("true")
              onComplete(pipelineRepo.findById(pipelineId)) {
                case Failure(ex) =>
                  complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

                case Success(None) =>
                  complete(StatusCodes.NotFound, ErrorResponse("Pipeline not found: " + pipelineId))

                case Success(Some(pipeline)) =>
                  onComplete(dataSourceRepo.findById(pipeline.sourceDataSourceId)) {
                    case Failure(ex) =>
                      complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

                    case Success(None) =>
                      complete(
                        StatusCodes.UnprocessableEntity,
                        ErrorResponse("DataSource not found: " + pipeline.sourceDataSourceId.value)
                      )

                    case Success(Some(dataSource)) =>
                      dataSource.sourceType match {
                        case SourceType.RestApi | SourceType.Sql =>
                          complete(
                            StatusCodes.UnprocessableEntity,
                            ErrorResponse(
                              "Unsupported source type for Spark job submission: " +
                                SourceType.asString(dataSource.sourceType) +
                                ". Only static and csv are currently supported."
                            )
                          )

                        case _ =>
                          onComplete(pipelineStepRepo.listByPipeline(pipelineId)) {
                            case Failure(ex) =>
                              complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

                            case Success(steps) =>
                              val runId   = java.util.UUID.randomUUID().toString
                              val startAt = Instant.now()

                              // Pre-execution: insert run record and prune old runs (non-dry only).
                              // recoverWith ensures a logging failure never blocks execution.
                              val preExec: Future[Unit] =
                                if (!isDry && pipelineRunRepo != null)
                                  pipelineRunRepo
                                    .insertRun(runId, pipelineId, startAt)
                                    .flatMap(_ => pipelineRunRepo.deleteOldRuns(pipelineId, keepN = 10))
                                    .recoverWith { case _ => Future.successful(()) }
                                else Future.successful(())

                              onComplete(
                                preExec.flatMap { _ =>
                                  inProcessEngine.loadRows(dataSource).flatMap { sourceRows =>
                                    inProcessEngine.execute(sourceRows, steps, dataSourceRepo)
                                  }
                                }
                              ) {
                                case Failure(ex) =>
                                  val errMsg = "Pipeline execution failed: " + Option(ex.getMessage).getOrElse(ex.getClass.getName)
                                  if (!isDry) {
                                    val failWork: Future[Unit] = for {
                                      _ <- if (pipelineRunRepo != null)
                                             pipelineRunRepo.updateRunTerminal(runId, "failed", Instant.now(), errorLog = Some(errMsg))
                                           else Future.successful(())
                                      _ <- pipelineRepo.updateLastRun(pipelineId, "failed", Instant.now())
                                    } yield ()
                                    onComplete(failWork) { _ =>
                                      complete(StatusCodes.UnprocessableEntity, ErrorResponse(errMsg))
                                    }
                                  } else {
                                    complete(StatusCodes.UnprocessableEntity, ErrorResponse(errMsg))
                                  }

                                case Success(resultRows) =>
                                  val jsRows = resultRows.map { rowMap =>
                                    JsObject(rowMap.map { case (k, v) => k -> anyToJsValue(v) })
                                  }.toVector
                                  val response = RunResultResponse(jsRows, jsRows.size)

                                  if (isDry) {
                                    val dryWork: Future[Unit] =
                                      if (pipelineRunRepo != null)
                                        pipelineRunRepo
                                          .insertDryRun(runId, pipelineId, startAt, resultRows.size)
                                          .recoverWith { case _ => Future.successful(()) }
                                      else Future.successful(())
                                    onComplete(dryWork) { _ =>
                                      complete(StatusCodes.OK, response)
                                    }
                                  } else {
                                    val now = Instant.now()
                                    val allWork: Future[Unit] = for {
                                      _ <- if (dataTypeRepo != null && resultRows.nonEmpty)
                                             upsertFieldsFromRows(pipeline.outputDataTypeId, resultRows)
                                           else Future.successful(())
                                      _ <- pipelineRepo.updateLastRun(pipelineId, "succeeded", now)
                                      _ <- if (pipelineRunRepo != null)
                                             pipelineRunRepo.updateRunTerminal(runId, "succeeded", now, rowCount = Some(resultRows.size))
                                           else Future.successful(())
                                    } yield ()
                                    onComplete(allWork) { _ =>
                                      complete(StatusCodes.OK, response)
                                    }
                                  }
                              }
                          }
                      }
                  }
              }
            }
          }
        },

        // GET /api/pipelines/:id/runs/:runId
        path("runs" / Segment) { runId =>
          get {
            cache.get(runId) match {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse(s"Run not found: $runId"))

              case Some(entry) =>
                val rowsJson: Option[JsValue] = entry.rows.map { rows =>
                  JsArray(rows.map { rowMap =>
                    JsObject(rowMap.map { case (k, v) => k -> anyToJsValue(v) })
                  }.toVector)
                }
                val rowCount: Option[Int] = entry.rows.map(_.size)
                complete(StatusCodes.OK, RunStatusResponse(entry.runId, entry.status, rowsJson, entry.error, rowCount))
            }
          }
        },

        // GET /api/pipelines/:id/steps/:stepId/preview
        path("steps" / Segment / "preview") { stepId =>
          get {
            onComplete(pipelineRepo.findById(pipelineId)) {
              case Failure(ex) =>
                complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

              case Success(None) =>
                complete(StatusCodes.NotFound, ErrorResponse("Pipeline not found: " + pipelineId))

              case Success(Some(pipeline)) =>
                onComplete(dataSourceRepo.findById(pipeline.sourceDataSourceId)) {
                  case Failure(ex) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

                  case Success(None) =>
                    complete(
                      StatusCodes.UnprocessableEntity,
                      ErrorResponse("DataSource not found: " + pipeline.sourceDataSourceId.value)
                    )

                  case Success(Some(dataSource)) =>
                    dataSource.sourceType match {
                      case SourceType.RestApi | SourceType.Sql =>
                        complete(
                          StatusCodes.UnprocessableEntity,
                          ErrorResponse(
                            "Unsupported source type for preview: " +
                              SourceType.asString(dataSource.sourceType) +
                              ". Only static and csv are currently supported."
                          )
                        )

                      case _ =>
                        onComplete(pipelineStepRepo.listByPipeline(pipelineId)) {
                          case Failure(ex) =>
                            complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

                          case Success(allSteps) =>
                            val sortedSteps = allSteps.sortBy(_.position)
                            sortedSteps.indexWhere(_.id == stepId) match {
                              case -1 =>
                                complete(StatusCodes.NotFound, ErrorResponse("Step not found: " + stepId))

                              case k =>
                                val slicedSteps = sortedSteps.take(k + 1)
                                onComplete(
                                  inProcessEngine.loadRows(dataSource).flatMap { sourceRows =>
                                    inProcessEngine.execute(sourceRows, slicedSteps, dataSourceRepo)
                                  }
                                ) {
                                  case Failure(ex) =>
                                    val errMsg = "Pipeline execution failed: " + Option(ex.getMessage).getOrElse(ex.getClass.getName)
                                    complete(StatusCodes.UnprocessableEntity, ErrorResponse(errMsg))

                                  case Success(resultRows) =>
                                    val allJsRows = resultRows.map { rowMap =>
                                      JsObject(rowMap.map { case (k, v) => k -> anyToJsValue(v) })
                                    }.toVector
                                    val totalCount = allJsRows.size
                                    val previewRows = allJsRows.take(10)
                                    complete(StatusCodes.OK, RunResultResponse(previewRows, totalCount))
                                }
                            }
                        }
                    }
                }
            }
          }
        },

        // GET /api/pipelines/:id/run-history
        path("run-history") {
          get {
            if (pipelineRunRepo == null) {
              complete(StatusCodes.OK, Vector.empty[PipelineRunRecord])
            } else {
              onComplete(pipelineRepo.findById(pipelineId)) {
                case Failure(ex) =>
                  complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

                case Success(None) =>
                  complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline not found: $pipelineId"))

                case Success(Some(_)) =>
                  onComplete(pipelineRunRepo.listByPipeline(pipelineId)) {
                    case Failure(ex) =>
                      complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

                    case Success(rows) =>
                      val records = rows.map { r =>
                        PipelineRunRecord(
                          id          = r.id,
                          pipelineId  = r.pipelineId,
                          status      = r.status,
                          startedAt   = r.startedAt.toString,
                          completedAt = r.completedAt.map(_.toString),
                          rowCount    = r.rowCount,
                          errorLog    = r.errorLog
                        )
                      }
                      complete(StatusCodes.OK, records)
                  }
              }
            }
          }
        }
      )
    }

  // 4.1 Infer field names from result rows and overwrite the output DataType schema
  private def upsertFieldsFromRows(
      dataTypeId: DataTypeId,
      rows: Seq[Map[String, Any]]
  ): Future[Unit] = {
    if (dataTypeRepo == null) return Future.successful(())
    val fieldNames = rows.headOption.map(_.keys.toVector).getOrElse(Vector.empty)
    val fields     = fieldNames.map(name => DataField(name, name, "string", nullable = true))
    dataTypeRepo.findById(dataTypeId).flatMap {
      case None => Future.successful(())
      case Some(existing) =>
        dataTypeRepo.update(existing.copy(fields = fields, updatedAt = Instant.now())).map(_ => ())
    }
  }

  private def anyToJsValue(v: Any): JsValue = v match {
    case null           => JsNull
    case b: Boolean     => JsBoolean(b)
    case i: Int         => JsNumber(i)
    case l: Long        => JsNumber(l)
    case f: Float       => JsNumber(BigDecimal(f.toDouble))
    case d: Double      => JsNumber(d)
    case bd: java.math.BigDecimal => JsNumber(BigDecimal(bd))
    case s: String      => JsString(s)
    case _              => JsString(v.toString)
  }
}
