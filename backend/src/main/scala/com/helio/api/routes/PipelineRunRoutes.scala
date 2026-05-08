package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols, PipelineRunRecord, RunStatusResponse, RunSubmitResponse}
import com.helio.domain.{AuthenticatedUser, SourceType}
import com.helio.infrastructure.{DataSourceRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.spark.{PipelineRunCache, RunStatus, SparkJobSubmitter}
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

class PipelineRunRoutes(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    submitter: SparkJobSubmitter,
    cache: PipelineRunCache,
    user: AuthenticatedUser,
    pipelineRunRepo: PipelineRunRepository = null
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines" / Segment) { pipelineId =>
      concat(
        // POST /api/pipelines/:id/run
        path("run") {
          post {
            onComplete(pipelineRepo.findById(pipelineId)) {
              case Failure(ex) =>
                complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

              case Success(None) =>
                complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline not found: $pipelineId"))

              case Success(Some(pipeline)) =>
                onComplete(dataSourceRepo.findById(pipeline.sourceDataSourceId)) {
                  case Failure(ex) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

                  case Success(None) =>
                    complete(
                      StatusCodes.UnprocessableEntity,
                      ErrorResponse(s"DataSource not found: ${pipeline.sourceDataSourceId.value}")
                    )

                  case Success(Some(dataSource)) =>
                    dataSource.sourceType match {
                      case SourceType.RestApi | SourceType.Sql =>
                        complete(
                          StatusCodes.UnprocessableEntity,
                          ErrorResponse(
                            s"Unsupported source type for Spark job submission: ${SourceType.asString(dataSource.sourceType)}. " +
                              "Only 'static' and 'csv' are currently supported."
                          )
                        )

                      case _ =>
                        onComplete(pipelineStepRepo.listByPipeline(pipelineId)) {
                          case Failure(ex) =>
                            complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))

                          case Success(steps) =>
                            onComplete(submitter.submit(pipeline, dataSource, steps, cache)) {
                              case Failure(ex) =>
                                complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                              case Success(runId) =>
                                complete(StatusCodes.Created, RunSubmitResponse(runId))
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
