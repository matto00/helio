package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols, PipelineSummaryResponse}
import com.helio.infrastructure.PipelineRepository

import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

class PipelineRoutes(pipelineRepo: PipelineRepository)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines") {
      pathEndOrSingleSlash {
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
        }
      }
    }
}
