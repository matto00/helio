package com.helio.api.routes

import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{JsonProtocols, PipelineScheduleResponse, PutPipelineScheduleRequest}
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.domain.AuthenticatedUser
import com.helio.services.PipelineScheduleService

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `/api/pipelines/:id/schedule`. All logic in
 *  [[PipelineScheduleService]]. Nested under the existing `pipelines` path
 *  prefix, mirroring `PipelineStepRoutes`'s nested-path shape. `PUT` is
 *  upsert (create-or-replace) since a pipeline has at most one schedule. */
class PipelineScheduleRoutes(
    pipelineScheduleService: PipelineScheduleService,
    user: AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines" / PipelineIdSegment / "schedule") { pipelineId =>
      pathEndOrSingleSlash {
        concat(
          get {
            ServiceResponse.run(pipelineScheduleService.find(pipelineId, user))(PipelineScheduleResponse.fromDomain)
          },
          put {
            entity(as[PutPipelineScheduleRequest]) { req =>
              ServiceResponse.run(pipelineScheduleService.put(pipelineId, req, user))(PipelineScheduleResponse.fromDomain)
            }
          },
          delete {
            ServiceResponse.runNoContent(pipelineScheduleService.delete(pipelineId, user))
          }
        )
      }
    }
}
