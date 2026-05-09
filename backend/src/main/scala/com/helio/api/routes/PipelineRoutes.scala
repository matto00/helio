package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{CreatePipelineRequest, ErrorResponse, JsonProtocols, PipelineSummaryResponse, UpdatePipelineRequest}
import com.helio.domain.AuthenticatedUser
import com.helio.infrastructure.PipelineRepository

import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

class PipelineRoutes(pipelineRepo: PipelineRepository, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              onComplete(pipelineRepo.listSummaries()) {
                case Success(summaries) =>
                  complete(
                    StatusCodes.OK,
                    summaries.map(s =>
                      PipelineSummaryResponse(
                        id                   = s.id,
                        name                 = s.name,
                        sourceDataSourceName = s.sourceDataSourceName,
                        outputDataTypeName   = s.outputDataTypeName,
                        outputDataTypeId     = s.outputDataTypeId,
                        lastRunStatus        = s.lastRunStatus,
                        lastRunAt            = s.lastRunAt
                      )
                    )
                  )
                case Failure(ex) =>
                  complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
              }
            },
            post {
              entity(as[CreatePipelineRequest]) { req =>
                if (req.name.trim.isEmpty)
                  complete(StatusCodes.BadRequest, ErrorResponse("name is required"))
                else if (req.sourceDataSourceId.trim.isEmpty)
                  complete(StatusCodes.BadRequest, ErrorResponse("sourceDataSourceId is required"))
                else if (req.outputDataTypeName.trim.isEmpty)
                  complete(StatusCodes.BadRequest, ErrorResponse("outputDataTypeName is required"))
                else {
                  onComplete(pipelineRepo.create(req.name.trim, req.sourceDataSourceId.trim, req.outputDataTypeName.trim, user.id)) {
                    case Success(Right(summary)) =>
                      complete(
                        StatusCodes.Created,
                        PipelineSummaryResponse(
                          id                   = summary.id,
                          name                 = summary.name,
                          sourceDataSourceName = summary.sourceDataSourceName,
                          outputDataTypeName   = summary.outputDataTypeName,
                          outputDataTypeId     = summary.outputDataTypeId,
                          lastRunStatus        = summary.lastRunStatus,
                          lastRunAt            = summary.lastRunAt
                        )
                      )
                    case Success(Left(msg)) if msg.contains("not found") =>
                      complete(StatusCodes.NotFound, ErrorResponse(msg))
                    case Success(Left(msg)) =>
                      complete(StatusCodes.BadRequest, ErrorResponse(msg))
                    case Failure(ex) =>
                      complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                  }
                }
              }
            }
          )
        },
        path(Segment) { pipelineId =>
          concat(
            get {
              onComplete(pipelineRepo.findSummaryById(pipelineId)) {
                case Success(Some(summary)) =>
                  complete(
                    StatusCodes.OK,
                    PipelineSummaryResponse(
                      id                   = summary.id,
                      name                 = summary.name,
                      sourceDataSourceName = summary.sourceDataSourceName,
                      outputDataTypeName   = summary.outputDataTypeName,
                      outputDataTypeId     = summary.outputDataTypeId,
                      lastRunStatus        = summary.lastRunStatus,
                      lastRunAt            = summary.lastRunAt
                    )
                  )
                case Success(None) =>
                  complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline not found: $pipelineId"))
                case Failure(ex) =>
                  complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
              }
            },
            patch {
              entity(as[UpdatePipelineRequest]) { req =>
                if (req.name.trim.isEmpty)
                  complete(StatusCodes.BadRequest, ErrorResponse("name must not be empty"))
                else {
                  onComplete(pipelineRepo.updateName(pipelineId, req.name.trim)) {
                    case Success(Some(summary)) =>
                      complete(
                        StatusCodes.OK,
                        PipelineSummaryResponse(
                          id                   = summary.id,
                          name                 = summary.name,
                          sourceDataSourceName = summary.sourceDataSourceName,
                          outputDataTypeName   = summary.outputDataTypeName,
                          outputDataTypeId     = summary.outputDataTypeId,
                          lastRunStatus        = summary.lastRunStatus,
                          lastRunAt            = summary.lastRunAt
                        )
                      )
                    case Success(None) =>
                      complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline not found: $pipelineId"))
                    case Failure(ex) =>
                      complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                  }
                }
              }
            }
          )
        }
      )
    }
}
