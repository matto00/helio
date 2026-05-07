package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{CreatePipelineRequest, ErrorResponse, JsonProtocols, PipelineSummaryResponse}
import com.helio.domain.AuthenticatedUser
import com.helio.infrastructure.PipelineRepository

import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

class PipelineRoutes(pipelineRepo: PipelineRepository, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines") {
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
      }
    }
}
